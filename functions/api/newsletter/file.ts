/**
 * Cloudflare Pages Function: GET /api/newsletter/file?key=…
 *
 * Serves the PDF attached to a newsletter issue, out of the same R2
 * bucket the library uses, under the `newsletter/` prefix.
 *
 * **Public on purpose, and only under that prefix**, for two reasons.
 * The mail service fetches this URL to attach the file to the email,
 * and it sends no cookies. And a parishioner who wants to read the
 * newsletter on their phone a month later should not have to sign in
 * to open the file they were already emailed.
 *
 * It is a sibling of image.ts rather than a widening of it. That route
 * refuses to serve anything that is not an image, which is a property
 * worth keeping intact; this one refuses to serve anything that is not
 * a PDF. Between them, nothing else under the prefix can be fetched at
 * all, and the 690 library books outside the prefix stay unreachable.
 *
 * A consequence worth stating, the same one the image route carries: a
 * newsletter in a parish-only issue is readable by anyone who has the
 * exact URL. Keys are not guessable, but they are not secret either.
 * Nothing belongs in the PDF that would not be handed to a stranger at
 * the door.
 */

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
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
