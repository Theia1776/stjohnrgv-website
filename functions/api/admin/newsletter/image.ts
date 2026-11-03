/**
 * Cloudflare Pages Function: POST /api/admin/newsletter/image
 *
 * Upload a photograph for a newsletter issue. Stores it in the same R2
 * bucket the library uses, under `newsletter/<slug>/<filename>`, and
 * returns the key for the admin page to drop into the issue.
 *
 * Admin-only. The *reading* route is public, because a mail client
 * sends no cookies and a session-gated image is a broken image in every
 * inbox — see functions/api/newsletter/image.ts. Writing is not.
 *
 * Deliberately narrow about what it will accept:
 *   - an image type a browser will actually render, checked against the
 *     bytes and not only the declared type, because a declared type is
 *     whatever the uploader says it is
 *   - under 8 MB, which is far more than a newsletter needs and well
 *     inside what a Function can hold in memory
 *   - a filename it has rewritten itself, so nothing a person typed
 *     ends up in a storage key
 *
 * Body: multipart/form-data with `file` and `slug`.
 * Returns: { key, url, bytes, type }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  LIBRARY_BUCKET?: R2Bucket;
}

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The first bytes of each format we accept. Checked against the file
 * itself: a browser decides what to do with a file by its bytes, and a
 * `Content-Type` is only what the uploader claimed.
 */
const SIGNATURES: { type: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  { type: "image/gif", ext: "gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
];

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
      .slice(0, 60) || "image"
  );
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
    if (!(file instanceof File)) {
      return wrap(jsonResponse({ error: "No file was sent." }, 400));
    }
    if (file.size === 0) {
      return wrap(jsonResponse({ error: "That file is empty." }, 400));
    }
    if (file.size > MAX_BYTES) {
      return wrap(
        jsonResponse(
          {
            error:
              `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is 8 MB — ` +
              "a photograph for a newsletter rarely needs to be more than one or two.",
          },
          413,
        ),
      );
    }

    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer.slice(0, 16));
    const match = SIGNATURES.find((s) => s.test(head));
    if (!match) {
      return wrap(
        jsonResponse(
          {
            error:
              "That doesn't look like a JPEG, PNG, WebP or GIF. If it came from a " +
              "phone it should be fine — if it is a HEIC, open it and save it as a JPEG first.",
          },
          415,
        ),
      );
    }

    // The slug groups an issue's photographs together so they can be
    // found later; it is sanitised the same way as the filename because
    // it also becomes part of the key.
    const slug = safeStem(String(form.get("slug") ?? "issue"));
    const stem = safeStem(file.name);
    // A short random tail: two photographs called "church.jpg" in one
    // issue must not overwrite each other, and a re-upload of a
    // corrected image must not be served from the old cached copy.
    const tail = crypto.randomUUID().slice(0, 6);
    const key = `newsletter/${slug}/${stem}-${tail}.${match.ext}`;

    await bucket.put(key, buffer, { httpMetadata: { contentType: match.type } });

    return wrap(
      jsonResponse(
        {
          key,
          url: `/api/newsletter/image?key=${encodeURIComponent(key)}`,
          bytes: file.size,
          type: match.type,
        },
        201,
      ),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
