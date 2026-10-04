/**
 * Cloudflare Pages Function: GET /api/library/file?key=<storage key>
 *
 * Serves a book's PDF bytes from the R2 bucket bound as LIBRARY_BUCKET.
 *
 * Why this exists: books used to be fetched from Supabase Storage via a
 * signed URL, which counts against a monthly transfer allowance. R2
 * charges nothing for downloads, so the library can grow and be read
 * without watching a meter. Nothing changes for the reader — the reader
 * page still asks /api/library/pdf where a book is, and simply gets
 * pointed here instead.
 *
 * Access rules are identical to the Supabase path, and are checked here
 * rather than trusted from the caller:
 *   - Anonymous visitors: public, non-hidden books only.
 *   - Signed-in parishioners: any non-hidden book.
 *   - Hidden (staging) books: admins only.
 *   - Catechism lessons (keys under "catechism/"): members only, and
 *     admins for anything not yet posted.
 *
 * Range requests are honoured so PDF.js can page through a large book
 * without pulling the whole thing first.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface R2Object {
  body: ReadableStream | null;
  size: number;
  httpEtag: string;
  range?: { offset: number; length: number };
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2Object | null>;
}

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Bound in the Cloudflare Pages project. Absent until R2 is set up,
   *  in which case this endpoint politely declines and the caller keeps
   *  using Supabase. */
  LIBRARY_BUCKET?: R2Bucket;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Byte ranges look like "bytes=0-1023" or "bytes=1024-". */
function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;
  // "bytes=-500" means the last 500 bytes.
  if (startRaw === "") {
    const length = Math.min(Number(endRaw), size);
    return { offset: size - length, length };
  }
  const offset = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (offset > end || offset >= size) return null;
  return { offset, length: end - offset + 1 };
}

/**
 * What a downloaded copy should be called, as a Content-Disposition.
 *
 * Two filenames, because this archive is full of accents, Greek and
 * Cyrillic: a plain ASCII one that every client understands, and the
 * real one in `filename*`, which modern browsers prefer. Without the
 * first, a title that is entirely non-Latin saves as a blank name.
 */
/** Where anything not yet moved to R2 still lives. */
const SUPABASE_BUCKET = "library";

function contentDisposition(title: string, key: string): string {
  const fallbackName = key.split("/").pop() || "document.pdf";
  const base = (title.trim() || fallbackName.replace(/\.pdf$/i, "")).slice(0, 120);
  const full = `${base}.pdf`;

  // Quotes and control characters would break out of the header.
  const toAscii = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      .trim();

  // A title written entirely in Greek or Cyrillic leaves nothing behind
  // once it's reduced to ASCII, and ".pdf" is not a filename. Fall back
  // to the stored key, then to something rather than nothing.
  let ascii = toAscii(full);
  if (!/[A-Za-z0-9]/.test(ascii.replace(/\.pdf$/i, ""))) {
    ascii = toAscii(fallbackName);
  }
  if (!/[A-Za-z0-9]/.test(ascii.replace(/\.pdf$/i, ""))) {
    ascii = "document.pdf";
  }

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  const url = new URL(context.request.url);
  // Not trimmed — see pdf.ts: a leading space can be part of the
  // filename, and trimming makes that book unreachable.
  const key = url.searchParams.get("key") ?? "";
  if (!key.trim()) return wrap(jsonResponse({ error: "Missing 'key' query parameter." }, 400));

  const bucket = context.env.LIBRARY_BUCKET;
  if (!bucket) {
    // R2 isn't connected to this project yet.
    return wrap(jsonResponse({ error: "File storage isn't configured." }, 503));
  }
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // ---- Who may read this file? ----
  const isLesson = key.startsWith("catechism/");
  // Kept for naming a downloaded copy: the catalogue's title reads far
  // better than the storage key, which is whatever the file arrived as.
  let fileTitle = "";
  if (isLesson) {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    const { data: lesson } = await admin
      .from("catechism_lessons")
      .select("published, title")
      .eq("pdf_storage_key", key)
      .maybeSingle();
    if (!lesson) return wrap(jsonResponse({ error: "Lesson not found." }, 404));
    fileTitle = String(lesson.title ?? "");
    if (!lesson.published) {
      const { data: viewer } = await admin
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      if (viewer?.role !== "admin") {
        return wrap(jsonResponse({ error: "This lesson hasn't been posted yet." }, 403));
      }
    }
  } else {
    const { data: book } = await admin
      .from("library_books")
      .select("public_access, hidden, title")
      .eq("pdf_storage_key", key)
      .maybeSingle();
    if (!book) return wrap(jsonResponse({ error: "File not found." }, 404));
    fileTitle = String(book.title ?? "");

    if (!session.user) {
      if (!book.public_access || book.hidden) {
        return wrap(jsonResponse({ error: "This text is for parishioners only. Please sign in." }, 403));
      }
    } else if (book.hidden) {
      const { data: viewer } = await admin
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      if (viewer?.role !== "admin") {
        return wrap(jsonResponse({ error: "This text isn't available yet." }, 403));
      }
    }
  }

  // ---- May they take a copy away? ----
  //
  // Reading and keeping are different permissions here. The lessons are
  // the parish's own teaching, written to be handed out, so any member
  // may save one. The library is not: most of it is still in copyright,
  // held for preservation, and a copy that leaves the site is a copy the
  // parish can no longer account for. So books download for admins only.
  //
  // Checked on the server, not merely hidden in the page — a button that
  // isn't drawn is not a rule.
  const wantsDownload = url.searchParams.get("download") === "1";
  if (wantsDownload && !isLesson) {
    if (!session.user) {
      return wrap(jsonResponse({ error: "Please sign in." }, 401));
    }
    const { data: viewer } = await admin
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (viewer?.role !== "admin") {
      return wrap(
        jsonResponse(
          { error: "Library books can be read here, but only an admin can download one." },
          403,
        ),
      );
    }
  }

  // ---- Serve it ----
  const head = await bucket.get(key);
  if (!head) {
    // Not in R2. The catechism lessons uploaded before lessons were
    // switched over still live in Supabase storage, and a file that
    // plainly exists should not answer 404 because of where it is kept.
    // Supabase signs a URL that carries the filename itself, so a
    // download stays a download through the redirect.
    const niceName = contentDisposition(fileTitle, key)
      .replace(/^.*filename\*=UTF-8''/, "");
    const { data: signed } = await admin.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(key, 120, wantsDownload ? { download: decodeURIComponent(niceName) } : undefined);
    if (signed?.signedUrl) {
      return wrap(Response.redirect(signed.signedUrl, 302));
    }
    return wrap(jsonResponse({ error: "File not found in storage." }, 404));
  }

  const range = parseRange(context.request.headers.get("Range"), head.size);
  const object = range ? await bucket.get(key, { range }) : head;
  if (!object || !object.body) {
    return wrap(jsonResponse({ error: "File not found in storage." }, 404));
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("ETag", object.httpEtag);
  // Books never change once uploaded — a new edition gets a new key — so
  // the browser may keep one for a day. Private: these are parish files.
  headers.set("Cache-Control", "private, max-age=86400");
  headers.set("Accept-Ranges", "bytes");

  if (wantsDownload) {
    headers.set("Content-Disposition", contentDisposition(fileTitle, key));
    // A saved copy shouldn't be answered from the cache of a page view,
    // or vice versa — they are different responses for the same bytes.
    headers.set("Cache-Control", "private, no-store");
  }

  if (range) {
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    return wrap(new Response(object.body, { status: 206, headers }));
  }

  headers.set("Content-Length", String(head.size));
  return wrap(new Response(object.body, { status: 200, headers }));
}
