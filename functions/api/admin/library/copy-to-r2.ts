/**
 * Cloudflare Pages Function: POST /api/admin/library/copy-to-r2
 *
 * Copies one book's PDF from Supabase Storage into the R2 bucket, so the
 * library can move off a 1 GB allowance and onto a 10 GB one where
 * downloads are free.
 *
 * One book per request, driven by a button on /admin/library/ that works
 * through the catalog. Doing it here rather than on Tina's machine means
 * no keys leave the server, and the copy runs at Cloudflare's end of the
 * wire. Books already in R2 report back as skipped, so the run is
 * resumable — close the tab and press it again later.
 *
 * The original stays in Supabase. Nothing is deleted until the R2 path
 * has been proven, and /api/library/pdf serves whichever place has the
 * book, so the library keeps working throughout the move.
 *
 * Body: { key: string }   — the book's pdf_storage_key
 * Returns:
 *   200 { ok: true, copied: boolean, size: number }
 *   400 { error }  — missing key
 *   404 { error }  — no such file in Supabase
 *   503 { error }  — R2 isn't bound to this project yet
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface R2Bucket {
  head(key: string): Promise<{ size: number } | null>;
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

const BUCKET = "library";
const SIGNED_URL_TTL_SECONDS = 300;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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
      return wrap(
        jsonResponse(
          { error: "R2 isn't connected to this project yet (binding LIBRARY_BUCKET is missing)." },
          503,
        ),
      );
    }

    let body: { key?: string };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key) return wrap(jsonResponse({ error: "Missing 'key'." }, 400));

    // Already there? Say so and move on — this is what makes a half-done
    // run safe to repeat.
    const existing = await bucket.head(key);
    if (existing) {
      return wrap(jsonResponse({ ok: true, copied: false, size: existing.size }, 200));
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      return wrap(jsonResponse({ error: signError?.message || "File not found in Supabase." }, 404));
    }

    const download = await fetch(signed.signedUrl);
    if (!download.ok) {
      return wrap(jsonResponse({ error: `Could not read the file (HTTP ${download.status}).` }, 502));
    }

    // Books are capped at 50 MB, comfortably inside a Worker's memory, so
    // the whole file is buffered rather than streamed — R2 wants a known
    // length, and a book this size doesn't warrant the complication.
    const bytes = await download.arrayBuffer();
    await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });

    return wrap(jsonResponse({ ok: true, copied: true, size: bytes.byteLength }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
