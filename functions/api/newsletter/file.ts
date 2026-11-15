/**
 * Cloudflare Pages Function: GET /api/newsletter/file?key=…
 *
 * Serves the PDF attached to a newsletter issue, out of the same R2
 * bucket the library uses, under the `newsletter/` prefix.
 *
 * **Signed-in parishioners only.** It used to be public, because the
 * mail service fetched this URL to attach the file and sends no
 * cookies. It no longer does: /api/admin/email reads the object out of
 * R2 itself and carries the bytes, so nothing outside the parish needs
 * to reach this route. A newsletter is written for the parish, and a
 * key that leaks should not hand it to the whole internet.
 *
 * It is a sibling of image.ts rather than a widening of it. That route
 * refuses to serve anything that is not an image, which is a property
 * worth keeping intact; this one refuses to serve anything that is not
 * a PDF. Between them, nothing else under the prefix can be fetched at
 * all, and the 690 library books outside the prefix stay unreachable.
 *
 * Anyone with an account may read it. That is the same bar registration
 * sets everywhere else on the site, and the newsletter is sent to every
 * one of them anyway.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface R2ObjectBody {
  body: ReadableStream | null;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Env {
  LIBRARY_BUCKET?: R2Bucket;
}

const PREFIX = "newsletter/";

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);
  if (!session.user) {
    return wrap(
      new Response("Sign in to read the parish newsletter.", {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }),
    );
  }

  const url = new URL(context.request.url);
  const key = url.searchParams.get("key") ?? "";

  if (!key || !key.startsWith(PREFIX) || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }
  if (!key.toLowerCase().endsWith(".pdf")) {
    return new Response("Not found", { status: 404 });
  }

  const bucket = context.env.LIBRARY_BUCKET;
  if (!bucket) return new Response("Storage is not configured.", { status: 500 });

  const object = await bucket.get(key);
  if (!object || !object.body) return new Response("Not found", { status: 404 });

  // The bucket is not a trusted source of content types. The extension
  // was fixed by the upload route, so the type is decided here.
  const stored = object.httpMetadata?.contentType ?? "";
  if (stored && stored !== "application/pdf") {
    return new Response("Not a PDF", { status: 415 });
  }

  if (context.request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });
  }

  // A readable name for anyone who saves it, and `inline` so a phone
  // opens it in the browser rather than demanding a download first.
  const name = url.searchParams.get("name")?.replace(/[^A-Za-z0-9 ._-]/g, "") || "newsletter.pdf";

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="${name}"`,
      ETag: object.httpEtag,
      // `private`: the response is now behind a sign-in, so it belongs
      // in the reader's own browser cache and in no shared one.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
