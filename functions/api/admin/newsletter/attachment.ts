/**
 * Cloudflare Pages Function: POST /api/admin/newsletter/attachment
 *
 * Upload the PDF that goes out attached to a newsletter email.
 *
 * The parish lays the newsletter out in a design tool and exports a
 * PDF. This stores that file in the same R2 bucket the library and the
 * newsletter photographs use, under `newsletter/<slug>/`, and hands
 * back the key for the issue row.
 *
 * Admin-only, and narrow about what it accepts, for the same reasons
 * as the image route next door:
 *   - it must actually be a PDF, checked against the first bytes and
 *     not the declared type, because a declared type is whatever the
 *     uploader says it is
 *   - under 20 MB, which is already more than most mail servers will
 *     take; the admin screen warns about size well before this
 *   - the filename is rewritten here, so nothing a person typed ends
 *     up in a storage key
 *
 * Body: multipart/form-data with `file` and `slug`.
 * Returns: { key, name, bytes }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
}

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  LIBRARY_BUCKET?: R2Bucket;
}

/**
 * Eight megabytes, and it is a refusal rather than a warning.
 *
 * It was twenty, on the reasoning that Gmail's limit is twenty-five.
 * That was wrong in the way that costs a whole evening: encoding
 * inflates a file by about a third, so twenty megabytes arrives as
 * twenty-seven and is refused — and it is refused *after* the mail
 * service has accepted the message and reported success. The send is
 * recorded as delivered and nobody receives anything.
 *
 * Eight megabytes leaves about eleven on the wire, under every limit
 * worth naming: Gmail 25, Outlook 20, and the ten-megabyte mailboxes a
 * fair number of people still have. A newsletter that is bigger than
 * this needs to be exported smaller, not sent hopefully.
 */
const MAX_BYTES = 8 * 1024 * 1024;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** A storage-safe stem. Nothing a person typed survives into the key. */
function safeStem(name: string): string {
  return (
    String(name ?? "")
      .replace(/\.[^.]*$/, "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "newsletter"
  );
}

/** The name the recipient sees on the attachment. Kept readable. */
function safeFilename(name: string): string {
  const stem = String(name ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .slice(0, 80);
  return `${stem || "Newsletter"}.pdf`;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (profile?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) {
      return wrap(jsonResponse({ error: "Storage isn't configured (LIBRARY_BUCKET)." }, 500));
    }

    let form: FormData;
    try {
      form = await context.request.formData();
    } catch {
      return wrap(jsonResponse({ error: "Expected a file upload." }, 400));
    }

    const file = form.get("file");
    if (!(file instanceof File)) return wrap(jsonResponse({ error: "No file was sent." }, 400));
    if (file.size === 0) return wrap(jsonResponse({ error: "That file is empty." }, 400));
    if (file.size > MAX_BYTES) {
      return wrap(
        jsonResponse(
          {
            error:
              `That file is ${(file.size / 1048576).toFixed(1)} MB — too big to email. ` +
              "The limit here is 8 MB, because encoding adds about a third on the way " +
              "out and mailboxes start refusing around 10. A file over the limit does " +
              "not bounce: it is accepted, reported as sent, and quietly never arrives. " +
              "Export it smaller and attach it again.",
          },
          413,
        ),
      );
    }

    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer.slice(0, 5));
    // "%PDF-" — every PDF starts this way.
    const isPdf =
      head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
    if (!isPdf) {
      return wrap(
        jsonResponse(
          { error: "That doesn't look like a PDF. Export the newsletter as a PDF and try again." },
          415,
        ),
      );
    }

    const slug = safeStem(String(form.get("slug") ?? "issue"));
    const stem = safeStem(file.name);
    // A short random tail, so a corrected re-upload is never served
    // from a cached copy of the file it replaced.
    const tail = crypto.randomUUID().slice(0, 6);
    const key = `newsletter/${slug}/${stem}-${tail}.pdf`;

    // The name the uploader gave it, kept alongside the file so the
    // archive can show a title a person recognises rather than the
    // storage-safe stem.
    await bucket.put(key, buffer, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { filename: safeFilename(file.name) },
    });

    return wrap(
      jsonResponse({ key, name: safeFilename(file.name), bytes: file.size }, 201),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
