/**
 * Cloudflare Pages Function: /api/admin/library/duplicates
 *
 *   GET  — which books are held twice, and which copy would go.
 *   POST — remove the redundant copies (row and file together).
 *
 * The same book arrived once from the parish's old library and once
 * from the MEGA archive, under different filenames. Two copies of
 * identical bytes cost storage and make a search return the same book
 * twice.
 *
 * **Identical bytes, not similar titles.** Grouping is by ETag, which
 * for these uploads is the MD5 of the file. A title match proves
 * nothing — the same work can be two different scans, and two different
 * works can share a short title — so anything that merely looks alike
 * is left alone for a person to judge.
 *
 * Which copy stays:
 *   1. It must have a catalogue row. A file with no row is just a file.
 *   2. The better title wins — a real one over a slug
 *      ("ante-nicene-fathers-vol-1-justin-martyr"), longer over shorter.
 *
 * Before a copy is deleted its extracted text is carried over if the
 * keeper hasn't any. The bytes are identical, so the text is equally
 * true of either row, and this way no book loses its searchability to
 * a tidy-up.
 *
 * The POST acts only on the keys it is given — the ones a human was
 * shown — and re-checks each is still a byte-identical duplicate of a
 * row that is staying. A preview that has gone stale deletes nothing.
 *
 * Body (POST): { keys: string[] }
 * Returns: { removed, freedBytes, textCarriedOver, skipped: [{key, why}] }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface R2Object {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
}

interface R2Bucket {
  list(options?: { limit?: number; cursor?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(key: string): Promise<void>;
}

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  LIBRARY_BUCKET?: R2Bucket;
}

interface BookRow {
  id: string;
  slug: string;
  title: string;
  pdf_storage_key: string;
  text_content?: string | null;
  text_chars?: number | null;
  text_status?: string | null;
  text_pages?: number | null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** A title that is really a filename slug, not something anyone typed. */
function looksLikeSlug(title: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(title.trim());
}

/**
 * Which of two rows for the same bytes should survive. Higher is
 * better: a real title beats a slug, and between two real titles the
 * fuller one usually carries the author and the volume.
 */
function keepScore(row: BookRow): number {
  let score = 0;
  if (!looksLikeSlug(row.title)) score += 1000;
  score += Math.min(row.title.length, 200);
  return score;
}

function cleanEtag(object: R2Object): string {
  return String(object.etag ?? object.httpEtag ?? "").replace(/"/g, "");
}

async function listBucket(bucket: R2Bucket): Promise<R2Object[]> {
  const all: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 1000, cursor });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return all;
}

interface Group {
  etag: string;
  size: number;
  keep: BookRow;
  remove: { key: string; title: string | null; id: string | null }[];
}

/**
 * Everything held twice, with the copy to keep already chosen.
 * Catechism lessons are left out: they have their own table and their
 * own admin page.
 */
async function findGroups(
  bucket: R2Bucket,
  supabase: ReturnType<typeof createClient>,
): Promise<{ groups: Group[]; error?: string }> {
  const objects = (await listBucket(bucket)).filter(
    (o) => o.key.toLowerCase().endsWith(".pdf") && !o.key.startsWith("catechism/"),
  );

  const { data: rows, error } = await supabase
    .from("library_books")
    .select("id, slug, title, pdf_storage_key, text_chars, text_status, text_pages");
  if (error) return { groups: [], error: error.message };

  const rowByKey = new Map<string, BookRow>();
  for (const row of (rows ?? []) as unknown as BookRow[]) {
    rowByKey.set(row.pdf_storage_key, row);
  }

  const byEtag = new Map<string, R2Object[]>();
  for (const object of objects) {
    const etag = cleanEtag(object);
    if (!etag) continue;
    if (!byEtag.has(etag)) byEtag.set(etag, []);
    byEtag.get(etag)!.push(object);
  }

  const groups: Group[] = [];
  for (const [etag, copies] of byEtag) {
    if (copies.length < 2) continue;

    const withRows = copies.filter((c) => rowByKey.has(c.key));
    // Nothing catalogued in this group: leave it be rather than guess
    // which stray file matters.
    if (withRows.length === 0) continue;

    const keeper = withRows
      .map((c) => rowByKey.get(c.key)!)
      .sort((a, b) => keepScore(b) - keepScore(a))[0];

    const remove = copies
      .filter((c) => c.key !== keeper.pdf_storage_key)
      .map((c) => {
        const row = rowByKey.get(c.key);
        return { key: c.key, title: row?.title ?? null, id: row?.id ?? null };
      });
    if (remove.length === 0) continue;

    groups.push({ etag, size: copies[0].size, keep: keeper, remove });
  }

  return { groups };
}

async function requireAdmin(context: { request: Request; env: Env }) {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) return { error: wrap(jsonResponse({ error: "Unauthorized" }, 401)) };
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: wrap(jsonResponse({ error: "Server not configured." }, 500)) };
  }
  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return { error: wrap(jsonResponse({ error: "Forbidden" }, 403)) };

  const bucket = context.env.LIBRARY_BUCKET;
  if (!bucket) {
    return { error: wrap(jsonResponse({ error: "Cloudflare storage isn't connected." }, 503)) };
  }
  return { supabase, bucket, wrap };
}

// ============================================================
// GET — what would go
// ============================================================
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const { supabase, bucket, wrap } = gate;

  try {
    const { groups, error } = await findGroups(bucket!, supabase!);
    if (error) return wrap!(jsonResponse({ error }, 500));

    const freedBytes = groups.reduce((n, g) => n + g.size * g.remove.length, 0);
    return wrap!(
      jsonResponse(
        {
          groups: groups.map((g) => ({
            size: g.size,
            keep: { title: g.keep.title, slug: g.keep.slug, key: g.keep.pdf_storage_key },
            remove: g.remove,
          })),
          copies: groups.reduce((n, g) => n + g.remove.length, 0),
          freedBytes,
        },
        200,
      ),
    );
  } catch (err) {
    return wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}

// ============================================================
// POST — remove them
// ============================================================
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const { supabase, bucket, wrap } = gate;

  try {
    let body: { keys?: unknown } = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const asked = new Set(
      Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : [],
    );
    if (asked.size === 0) {
      return wrap!(jsonResponse({ error: "No copies were named for removal." }, 400));
    }

    // Worked out again here rather than trusted from the caller: the
    // only thing the request decides is which of these to act on.
    const { groups, error } = await findGroups(bucket!, supabase!);
    if (error) return wrap!(jsonResponse({ error }, 500));

    let removed = 0;
    let freedBytes = 0;
    let textCarriedOver = 0;
    const skipped: { key: string; why: string }[] = [];
    const removable = new Map<string, { group: Group; entry: Group["remove"][number] }>();
    for (const group of groups) {
      for (const entry of group.remove) removable.set(entry.key, { group, entry });
    }

    for (const key of asked) {
      const found = removable.get(key);
      if (!found) {
        skipped.push({ key, why: "no longer a duplicate of a book that is staying" });
        continue;
      }
      const { group, entry } = found;

      // The bytes are identical, so text read from one copy is equally
      // true of the other. Carry it over rather than lose it.
      if (entry.id && !group.keep.text_status) {
        const { data: doomed } = await supabase!
          .from("library_books")
          .select("text_content, text_chars, text_status, text_pages")
          .eq("id", entry.id)
          .maybeSingle();
        if (doomed?.text_status === "ok" && doomed.text_content) {
          const { error: carryError } = await supabase!
            .from("library_books")
            .update({
              text_content: doomed.text_content,
              text_chars: doomed.text_chars,
              text_status: doomed.text_status,
              text_pages: doomed.text_pages,
            })
            .eq("id", group.keep.id);
          if (!carryError) {
            textCarriedOver++;
            group.keep.text_status = String(doomed.text_status);
          }
        }
      }

      if (entry.id) {
        const { error: deleteError } = await supabase!
          .from("library_books")
          .delete()
          .eq("id", entry.id);
        if (deleteError) {
          skipped.push({ key, why: `catalogue row would not delete: ${deleteError.message}` });
          continue;
        }
      }

      // The file last, and only once the row is gone — the other way
      // round would leave a book that lists but will not open.
      try {
        await bucket!.delete(key);
      } catch (err) {
        skipped.push({
          key,
          why: `row removed but the file would not: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      removed++;
      freedBytes += group.size;
    }

    return wrap!(jsonResponse({ removed, freedBytes, textCarriedOver, skipped }, 200));
  } catch (err) {
    return wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
