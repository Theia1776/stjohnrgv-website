/**
 * Cloudflare Pages Function: GET /api/catechism/search?q=<words>
 *
 * Search the catechism lessons — titles, teachers, series, descriptions
 * AND the text inside each lesson PDF (migration 017).
 *
 * Searching happens here rather than in the browser because the browser
 * would have to download every lesson's full text to do it. The lesson
 * list stays small and this endpoint carries only what matched: the
 * lesson, and a short passage around the first hit with the page it
 * falls on, so a quotation can be found without opening every lesson.
 *
 * Matching mirrors the library search, including the part learned the
 * hard way: requiring every word is right when it works, but it
 * dead-ends on a half-remembered lesson, so when nothing carries every
 * word the lessons carrying the most are returned instead, flagged as
 * loosened. At least two words must land before that happens — one word
 * out of four is not a near miss.
 *
 * Drafts are searched only for admins, exactly as the lesson list does.
 *
 * Response:
 *   200 { query, loosened, results: [{ slug, title, teacher, series,
 *                                      lesson_date, published, where,
 *                                      snippet, page }] }
 *   400 { error }   — missing ?q
 *   401 { error }   — not signed in
 *   500 { error }
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** A page marker written by extraction: ␞printedLabel|pdfPage␞ */
const PAGE_MARKER = /␞([^␞|]*)\|?([^␞]*)␞/g;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Fold accents, lowercase, and turn punctuation into spaces — so a
 * lesson typed the way it is spoken ("Chrysostom, On the Priesthood")
 * matches, and a trailing comma never stops a word.
 */
function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface LessonRow {
  slug: string;
  title: string;
  teacher: string | null;
  series: string | null;
  lesson_date: string | null;
  description: string | null;
  published: boolean;
  text_content: string | null;
}

/**
 * The passage around the first hit, and which page it sits on.
 *
 * The page comes from the markers extraction wrote between pages: the
 * last one before the hit is the page the hit is on. The markers are
 * stripped from the snippet itself — they're plumbing, not words.
 */
function findInText(text: string, terms: string[]): { snippet: string; page: string | null } | null {
  const haystack = normalize(text);
  // The longest term first: it's the most distinctive, so the passage
  // it lands in is the one worth showing.
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  let at = -1;
  for (const term of ordered) {
    at = haystack.indexOf(term);
    if (at !== -1) break;
  }
  if (at === -1) return null;

  // normalize() collapses runs of punctuation, so an offset into the
  // normalized string can drift from the original. Walk the original
  // forward counting normalized characters to land back on the source.
  let plain = 0;
  let source = 0;
  let lastWasSpace = false;
  while (source < text.length && plain < at) {
    const ch = normalize(text[source]);
    if (ch === "") {
      // A character that normalizes away entirely (a combining accent).
      source++;
      continue;
    }
    if (ch === " ") {
      if (!lastWasSpace) plain++;
      lastWasSpace = true;
    } else {
      plain += ch.length;
      lastWasSpace = false;
    }
    source++;
  }

  const before = text.slice(0, source);
  let page: string | null = null;
  for (const match of before.matchAll(PAGE_MARKER)) {
    page = (match[1] || match[2] || "").trim() || page;
  }

  const start = Math.max(0, source - 90);
  const end = Math.min(text.length, source + 190);
  const snippet = text
    .slice(start, end)
    .replace(PAGE_MARKER, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    snippet: `${start > 0 ? "…" : ""}${snippet}${end < text.length ? "…" : ""}`,
    page,
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    const url = new URL(context.request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query) return wrap(jsonResponse({ error: "Missing 'q' query parameter." }, 400));

    if (!session.user) return wrap(jsonResponse({ error: "Please sign in to search." }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: viewer } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    const isAdmin = viewer?.role === "admin";

    let rowsQuery = supabase
      .from("catechism_lessons")
      .select(
        "slug, title, teacher, series, lesson_date, description, published, text_content",
      )
      .order("lesson_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (!isAdmin) rowsQuery = rowsQuery.eq("published", true);

    const { data, error } = await rowsQuery;
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const lessons = (data ?? []) as unknown as LessonRow[];
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return wrap(jsonResponse({ query, loosened: false, results: [] }, 200));
    }

    // Two haystacks per lesson, kept apart so a result can say whether
    // the words were in the title or inside the lesson itself.
    const scored = lessons.map((lesson) => {
      const meta = normalize(
        [lesson.title, lesson.teacher, lesson.series, lesson.description].join(" "),
      );
      const body = normalize(lesson.text_content ?? "");
      const hits = terms.filter((t) => meta.includes(t) || body.includes(t));
      const inMeta = terms.some((t) => meta.includes(t));
      const inBody = terms.some((t) => body.includes(t));
      return { lesson, score: hits.length, inMeta, inBody };
    });

    const exact = scored.filter((s) => s.score === terms.length);
    let chosen = exact;
    let loosened = false;
    if (exact.length === 0 && terms.length >= 2) {
      const partial = scored.filter((s) => s.score > 0);
      const best = partial.reduce((top, s) => Math.max(top, s.score), 0);
      // One word out of four is not a near miss — it's "there"
      // containing "here" — and a wrong lesson is worse than none.
      if (best >= 2) {
        chosen = partial.filter((s) => s.score === best);
        loosened = true;
      }
    }

    const results = chosen.map(({ lesson, inMeta, inBody }) => {
      const found = inBody && lesson.text_content ? findInText(lesson.text_content, terms) : null;
      return {
        slug: lesson.slug,
        title: lesson.title,
        teacher: lesson.teacher,
        series: lesson.series,
        lesson_date: lesson.lesson_date,
        published: lesson.published,
        // What matched, so the list can say "in the lesson" rather than
        // leaving someone to wonder why a title they didn't type appeared.
        where: inBody && inMeta ? "both" : inBody ? "text" : "details",
        snippet: found?.snippet ?? null,
        page: found?.page ?? null,
      };
    });

    return wrap(jsonResponse({ query, loosened, results }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
