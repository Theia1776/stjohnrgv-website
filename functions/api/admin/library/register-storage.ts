/**
 * Cloudflare Pages Function: POST /api/admin/library/register-storage
 *
 * Finds PDFs sitting in the R2 bucket with no catalogue entry, and makes
 * one for each.
 *
 * This is how the MEGA archive gets in without anyone handing over a
 * database key: the files are pushed to R2 from a workstation (which
 * only needs the R2 token), and then the site — which already has its
 * own Supabase key — notices them and writes the rows.
 *
 * Everything lands as HIDDEN, exactly as the June batches did, so
 * nothing reaches parishioners until an admin promotes it.
 *
 * Titles and authors come from the filename, which in this archive is
 * descriptive ("Saint John of Damascus-Writings.pdf"). They can be
 * corrected in the admin table afterwards, and the text extraction that
 * fills in page numbers is the existing browser pass.
 *
 * Body: { limit?: number }  — how many to register in this call
 *                             (default 50; the page loops)
 * Returns: { added, skipped, remaining, books: [{title, key}] }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface R2Object {
  key: string;
  size: number;
}

interface R2Bucket {
  list(options?: { limit?: number; cursor?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
}

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  LIBRARY_BUCKET?: R2Bucket;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

/**
 * Titles and authors from a filename, in the two shapes this archive
 * uses: "Title - Author.pdf" and "Author-Title.pdf". A bare hyphen only
 * splits when what precedes it reads as a person, so "Well-Ordered
 * Prayer" stays whole.
 */
const NAME_START =
  /^(saint|st\.?|father|fr\.?|blessed|elder|abbot|archbishop|bishop|metropolitan|patriarch|pope|monk|nun|hieromonk|archimandrite|venerable)\b/i;

function looksLikePerson(text: string): boolean {
  const trimmed = text.trim();
  if (NAME_START.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  return (
    words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-ZÀ-Þ][\w'’.-]*$/.test(w))
  );
}

function fromFilename(filename: string): { title: string; author: string } {
  const base = filename.replace(/\.pdf$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();

  const spaced = base.split(/\s+[-–—]\s+/);
  if (spaced.length >= 2) {
    return { title: spaced[0].trim(), author: spaced.slice(1).join(" - ").trim() };
  }
  const bare = base.match(/^([^-–—]{4,60})[-–—](.{4,})$/);
  if (bare && looksLikePerson(bare[1])) {
    return { title: bare[2].trim(), author: bare[1].trim() };
  }
  return { title: base, author: "" };
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (profile?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) {
      return wrap(jsonResponse({ error: "Cloudflare storage isn't connected." }, 503));
    }

    let body: { limit?: number } = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

    // Everything the catalogue already knows about. The bucket holds
    // hundreds of files and the catalogue hundreds of rows; comparing
    // both in memory is far cheaper than a query per file.
    const { data: existing, error: listError } = await supabase
      .from("library_books")
      .select("pdf_storage_key, slug");
    if (listError) return wrap(jsonResponse({ error: listError.message }, 500));

    const knownKeys = new Set((existing ?? []).map((b) => b.pdf_storage_key as string));
    const knownSlugs = new Set((existing ?? []).map((b) => b.slug as string));

    // Walk the bucket. R2 pages at 1000; the library is smaller than
    // that today but this doesn't assume so.
    const unregistered: R2Object[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ limit: 1000, cursor });
      for (const object of page.objects) {
        if (!object.key.toLowerCase().endsWith(".pdf")) continue;
        // Catechism lessons live in the same bucket under their own
        // prefix and have their own table — leave them be.
        if (object.key.startsWith("catechism/")) continue;
        if (knownKeys.has(object.key)) continue;
        unregistered.push(object);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const batch = unregistered.slice(0, limit);
    const added: { title: string; key: string }[] = [];
    let skipped = 0;

    for (const object of batch) {
      const guess = fromFilename(object.key);
      let slug = slugify(guess.title);

      // Two different books can share a short title. Rather than let the
      // second be dropped, give it a distinguishing suffix.
      if (knownSlugs.has(slug)) {
        const suffix = slugify(guess.author) || Math.random().toString(36).slice(2, 6);
        slug = `${slug}-${suffix}`.slice(0, 80);
        if (knownSlugs.has(slug)) {
          skipped++;
          continue;
        }
      }

      const { error } = await supabase.from("library_books").insert({
        slug,
        title: guess.title,
        author: guess.author || null,
        category: "Other",
        languages: ["English"],
        description: null,
        pdf_storage_key: object.key,
        hidden: true,
        public_access: false,
      });
      if (error) {
        skipped++;
        continue;
      }
      knownKeys.add(object.key);
      knownSlugs.add(slug);
      added.push({ title: guess.title, key: object.key });
    }

    return wrap(
      jsonResponse(
        {
          added: added.length,
          skipped,
          remaining: Math.max(unregistered.length - batch.length, 0),
          books: added,
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
