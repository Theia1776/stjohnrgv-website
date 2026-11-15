/**
 * Cloudflare Pages Function: GET /api/newsletter/archive
 *
 * Every newsletter PDF the parish has sent, newest first.
 *
 * The parish lays each issue out in a design tool and emails the
 * exported PDF. Those files are already in R2 — the upload route puts
 * them there so the mailer can read them — so the archive is a listing
 * of that prefix rather than a second place to keep the same file.
 *
 * Public, same as the file route it links to. Nobody should have to
 * make an account to read the parish newsletter.
 */

interface R2Object {
  key: string;
  size: number;
  uploaded: string | Date;
  customMetadata?: Record<string, string>;
}
interface R2Bucket {
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    include?: ("customMetadata" | "httpMetadata")[];
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
}

interface Env {
  LIBRARY_BUCKET?: R2Bucket;
}

const PREFIX = "newsletter/";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * A title a person would recognise.
 *
 * Uploads carry the original filename in custom metadata, so that wins.
 * Older files predate it, and their key ends in a random tail added so
 * a corrected re-upload is never served from cache — strip that, turn
 * the separators back into spaces, and it reads close enough to the
 * name it was given.
 */
function titleFor(object: R2Object): string {
  const original = object.customMetadata?.filename?.trim();
  if (original) return original.replace(/\.pdf$/i, "");

  const stem = object.key.split("/").pop()?.replace(/\.pdf$/i, "") ?? "Newsletter";
  return (
    stem
      .replace(/-[a-f0-9]{6}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Newsletter"
  );
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const bucket = context.env.LIBRARY_BUCKET;
  if (!bucket) return jsonResponse({ error: "Storage isn't configured." }, 500);

  try {
    const issues: { key: string; title: string; bytes: number; uploaded: string }[] = [];
    let cursor: string | undefined;

    // The prefix holds photographs too; only the PDFs are issues.
    do {
      const page = await bucket.list({
        prefix: PREFIX,
        limit: 1000,
        cursor,
        include: ["customMetadata"],
      });
      for (const object of page.objects) {
        if (!object.key.toLowerCase().endsWith(".pdf")) continue;
        issues.push({
          key: object.key,
          title: titleFor(object),
          bytes: object.size,
          uploaded: new Date(object.uploaded).toISOString(),
        });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    issues.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
    return jsonResponse({ issues }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
}
