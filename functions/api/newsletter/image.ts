/**
 * Cloudflare Pages Function: GET /api/newsletter/image?key=…
 *
 * Serves a photograph belonging to a newsletter issue, out of the same
 * R2 bucket the library uses, under the `newsletter/` prefix.
 *
 * **Public on purpose, and only under that prefix.** A newsletter image
 * has to load in an email client, and a mail client sends no cookies —
 * so anything that needed a session here would show a broken picture in
 * every inbox. The prefix check is what keeps that from becoming a hole
 * into the rest of the bucket, where 690 library books live: a key is
 * rejected unless it begins `newsletter/`, and `..` is refused outright
 * so no key can climb out of it.
 *
 * A consequence worth stating: a photograph in a parish-only issue is
 * reachable by anyone who has its exact URL. Keys are not guessable,
 * but they are not secret either. Nothing belongs in a newsletter
 * photograph that would not be shown to a stranger.
 *
 * Cached hard, because an issue's photographs never change once it has
 * gone out — and if one does, it gets a new filename.
 */

/** Just enough of the R2 binding's shape for what this endpoint does. */
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

/** What a browser will actually render, by extension. */
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export async function onRequestGet(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const url = new URL(context.request.url);
  // Not trimmed. A filename with a leading space is a real thing — one
  // library book is named that way, and trimming made it unreachable
  // while it sat in the bucket the whole time.
  const key = url.searchParams.get("key") ?? "";

  if (!key || !key.startsWith(PREFIX) || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const bucket = context.env.LIBRARY_BUCKET;
  if (!bucket) {
    return new Response("Storage is not configured.", { status: 500 });
  }

  const object = await bucket.get(key);
  if (!object || !object.body) {
    return new Response("Not found", { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = object.httpMetadata?.contentType ?? TYPES[ext] ?? "application/octet-stream";

  // Refuse to serve anything that isn't an image, whatever got uploaded
  // under this prefix. A bucket is not a trusted source of content
  // types, and `nosniff` plus a wrong type is a broken image, not a
  // script running in the parish's origin.
  if (!contentType.startsWith("image/")) {
    return new Response("Not an image", { status: 415 });
  }

  // An If-None-Match from a browser that already has it.
  if (context.request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      ETag: object.httpEtag,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
