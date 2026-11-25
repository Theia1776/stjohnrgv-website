/**
 * Cloudflare Pages Function: /api/board/threads
 *
 * GET  ?category=the-kitchen   the threads in one category
 * POST { category, title, body }   start a new thread
 *
 * Names are joined in JS rather than through a Supabase relationship
 * select, because the author of a thread and the author of its newest
 * post are two different lookups into the same handful of profiles and
 * a parish board's rows number in the tens. Two small queries and a
 * Map beat a nested select nobody can read.
 */

import { whenText } from "../../../src/lib/board-events.ts";
import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  shortName,
  type BoardEnv,
  suspensionBlock,
} from "../../../src/lib/board-access.ts";
import { recordMentions } from "../../../src/lib/board-mentions.ts";
import { attachPhotos } from "../../../src/lib/board-photos.ts";
import { attachFiles } from "../../../src/lib/board-files.ts";

const MAX_TITLE = 160;
const MAX_BODY = 10000;

interface ThreadRow {
  id: string;
  title: string;
  author_id: string | null;
  pinned: boolean;
  locked: boolean;
  announce: boolean;
  created_at: string;
  close_requested_at: string | null;
  last_post_at: string;
  post_count: number;
  view_count: number;
}

/** Anyone whose account is gone shows up as this, not as a blank. */
const GONE = "A former parishioner";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const slug = new URL(context.request.url).searchParams.get("category")?.trim() ?? "";
    if (!slug) return wrap(jsonResponse({ error: "Which category?" }, 400));

    const { data: category, error: catError } = await supabase
      .from("board_categories")
      .select("id, slug, name, description, hidden, audience")
      .eq("slug", slug)
      .maybeSingle();
    if (catError) return wrap(jsonResponse({ error: catError.message }, 500));
    if (!category) return wrap(jsonResponse({ error: "No such category." }, 404));
    if (!canSeeCategory(viewer, category)) {
      return wrap(jsonResponse({ error: "No such category." }, 404));
    }

    const { data: threads, error: threadError } = await supabase
      .from("board_threads")
      .select(
        "id, title, author_id, pinned, locked, announce, created_at, last_post_at, post_count, view_count, close_requested_at",
      )
      .eq("category_id", category.id)
      .order("pinned", { ascending: false })
      .order("last_post_at", { ascending: false });
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));

    // Pinned topics keep to the order they were created in, so the
    // welcome stays above the "introduce yourself" thread however busy
    // that one gets. Everything else stays newest-activity first, which
    // is the order the query already returned (and sort() is stable).
    const rows = ((threads ?? []) as ThreadRow[]).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (!a.pinned) return 0;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    });
    const threadIds = rows.map((t) => t.id);

    // Event topics show when and where under the title.
    const eventOf = new Map<string, { when: string; place: string }>();
    if (threadIds.length) {
      const { data: evs } = await supabase
        .from("board_events")
        .select("thread_id, event_date, start_time, end_time, place")
        .in("thread_id", threadIds);
      for (const e of evs ?? []) {
        eventOf.set(e.thread_id as string, {
          when: whenText(String(e.event_date), String(e.start_time).slice(0, 5), e.end_time ? String(e.end_time).slice(0, 5) : null),
          place: e.place as string,
        });
      }
    }

    // Who wrote the newest post in each thread.
    const lastAuthorByThread = new Map<string, string | null>();
    if (threadIds.length) {
      const { data: posts, error: postError } = await supabase
        .from("board_posts")
        .select("thread_id, author_id, created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true });
      if (postError) return wrap(jsonResponse({ error: postError.message }, 500));
      // Ascending, so the last write for each thread wins.
      for (const p of posts ?? []) {
        lastAuthorByThread.set(p.thread_id as string, (p.author_id as string | null) ?? null);
      }
    }

    const names = await lookupNames(
      supabase,
      [...rows.map((t) => t.author_id), ...lastAuthorByThread.values()],
    );

    const { data: reads, error: readError } = await supabase
      .from("board_reads")
      .select("thread_id, last_read_at")
      .eq("user_id", viewer.id)
      .in("thread_id", threadIds.length ? threadIds : ["00000000-0000-0000-0000-000000000000"]);
    if (readError) return wrap(jsonResponse({ error: readError.message }, 500));

    const readAt = new Map<string, number>();
    for (const r of reads ?? []) {
      readAt.set(r.thread_id as string, new Date(r.last_read_at as string).getTime());
    }

    return wrap(
      jsonResponse(
        {
          category: {
            slug: category.slug,
            name: category.name,
            description: category.description,
            hidden: category.hidden,
          },
          threads: rows.map((t) => {
            const seen = readAt.get(t.id);
            const lastAuthorId = lastAuthorByThread.get(t.id) ?? null;
            return {
              id: t.id,
              title: t.title,
              startedBy: t.author_id ? (names.get(t.author_id) ?? GONE) : GONE,
              lastPostBy: lastAuthorId ? (names.get(lastAuthorId) ?? GONE) : GONE,
              pinned: t.pinned,
              locked: t.locked,
              announce: !!t.announce,
              event: eventOf.get(t.id) ?? null,
              createdAt: t.created_at,
              lastPostAt: t.last_post_at,
              replyCount: Math.max(0, (t.post_count ?? 0) - 1),
              viewCount: t.view_count ?? 0,
              // Only moderators are told; it's their queue.
              closeRequested: viewer.isModerator && !!t.close_requested_at,
              unread: seen === undefined || new Date(t.last_post_at).getTime() > seen,
              mine: t.author_id === viewer.id,
            };
          }),
          viewer: {
            displayName: viewer.displayName,
            isAdmin: viewer.isAdmin,
            isModerator: viewer.isModerator,
          },
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    let body: { category?: unknown; title?: unknown; body?: unknown; photoIds?: unknown; fileIds?: unknown; poll?: unknown; isQuestion?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const slug = typeof body.category === "string" ? body.category.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.body === "string" ? body.body.trim() : "";

    if (!slug) return wrap(jsonResponse({ error: "Which category?" }, 400));
    if (!title) return wrap(jsonResponse({ error: "Please give the thread a title." }, 400));
    if (title.length > MAX_TITLE) {
      return wrap(jsonResponse({ error: `Titles top out at ${MAX_TITLE} characters.` }, 400));
    }
    if (!text) return wrap(jsonResponse({ error: "Please write something to start it off." }, 400));

    // An optional poll: 2 to 8 choices.
    let poll: { options: string[]; multiple: boolean; question: string; showVoters: boolean } | null = null;
    if (body.poll && typeof body.poll === "object") {
      const raw = body.poll as { options?: unknown; multiple?: unknown; question?: unknown };
      const question = typeof raw.question === "string" ? raw.question.trim() : "";
      if (!question) return wrap(jsonResponse({ error: "Give the poll a question." }, 400));
      if (question.length > 200) {
        return wrap(jsonResponse({ error: "Keep the question to 200 characters or fewer." }, 400));
      }
      const options = Array.isArray(raw.options)
        ? raw.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)
        : [];
      if (options.length < 2 || options.length > 8) {
        return wrap(jsonResponse({ error: "A poll needs between two and eight choices." }, 400));
      }
      if (options.some((o) => o.length > 100)) {
        return wrap(jsonResponse({ error: "Keep each choice to 100 characters or fewer." }, 400));
      }
      const showVoters = (raw as { showVoters?: unknown }).showVoters === true;
      if (showVoters && slug !== "events") {
        return wrap(jsonResponse({ error: "RSVP is only for the Events room." }, 400));
      }
      poll = { options, multiple: raw.multiple === true, question, showVoters };
    }
    if (text.length > MAX_BODY) {
      return wrap(jsonResponse({ error: `Posts top out at ${MAX_BODY} characters.` }, 400));
    }

    const { data: category, error: catError } = await supabase
      .from("board_categories")
      .select("id, hidden, audience")
      .eq("slug", slug)
      .maybeSingle();
    if (catError) return wrap(jsonResponse({ error: catError.message }, 500));
    if (!category || !canSeeCategory(viewer, category)) {
      return wrap(jsonResponse({ error: "No such category." }, 404));
    }

    const { data: thread, error: insertError } = await supabase
      .from("board_threads")
      .insert({ category_id: category.id, title, author_id: viewer.id, ...(body.isQuestion === true ? { is_question: true } : {}) })
      .select("id")
      .single();
    if (insertError) return wrap(jsonResponse({ error: insertError.message }, 500));

    const { data: firstPost, error: postError } = await supabase
      .from("board_posts")
      .insert({ thread_id: thread.id, author_id: viewer.id, body: text })
      .select("id")
      .single();
    if (postError) {
      // A thread with no opening post is a broken row, not a thread.
      await supabase.from("board_threads").delete().eq("id", thread.id);
      return wrap(jsonResponse({ error: postError.message }, 500));
    }

    await attachPhotos(supabase, viewer.id, firstPost.id as string, body.photoIds);
    await attachFiles(supabase, viewer.id, firstPost.id as string, body.fileIds);
    await recordMentions(supabase, firstPost.id as string, viewer.id, text);

    if (poll) {
      const { data: made, error: pollError } = await supabase
        .from("board_polls")
        .insert({ thread_id: thread.id, multiple: poll.multiple, question: poll.question, show_voters: poll.showVoters })
        .select("id")
        .single();
      if (!pollError && made) {
        await supabase.from("board_poll_options").insert(
          poll.options.map((label, position) => ({ poll_id: made.id, label, position })),
        );
      }
    }

    // You've read what you just wrote.
    await supabase
      .from("board_reads")
      .upsert(
        { user_id: viewer.id, thread_id: thread.id, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,thread_id" },
      );

    return wrap(jsonResponse({ id: thread.id }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

/** first name + last initial for a set of profile ids. */
async function lookupNames(
  supabase: NonNullable<Awaited<ReturnType<typeof requireBoardAccess>>["supabase"]>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (!unique.length) return names;

  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", unique);

  for (const p of data ?? []) {
    names.set(
      p.id as string,
      shortName(p.first_name as string | null, p.last_name as string | null),
    );
  }
  return names;
}
