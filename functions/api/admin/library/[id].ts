/**
 * Cloudflare Pages Function: /api/admin/library/:id
 *
 *  PATCH  — update metadata for an existing book (no PDF change).
 *  DELETE — remove the book row and delete its PDF from storage.
 *
 * Admin-only, same role-check pattern as the rest of /api/admin/*.
 * The PATCH path deliberately does NOT support changing the PDF — to
 * replace a PDF, delete the book and re-upload it. Keeping the upload
 * flow one-way avoids orphaned blobs from half-completed swaps.
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const BUCKET = "library";
// Matches the cap in index.ts — roughly a 1,200-page book.
const MAX_TEXT_CHARS = 3_000_000;

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

async function isAdmin(supabase: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  return data?.role === "admin";
}

interface PagesContext {
  request: Request;
  env: Env;
  params: { id: string };
}

// ============================================================
// PATCH — update metadata only
// ============================================================
export async function onRequestPatch(context: PagesContext): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const id = (context.params.id ?? "").trim();
    if (!id) return wrap(jsonResponse({ error: "Missing book id." }, 400));

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!(await isAdmin(supabase, session.user.id))) {
      return wrap(jsonResponse({ error: "Forbidden" }, 403));
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    // Whitelist of metadata fields the admin form can touch. The
    // pdf_storage_key is intentionally NOT here — to swap a PDF
    // you delete the book and re-create it.
    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (!t) return wrap(jsonResponse({ error: "Title cannot be empty." }, 400));
      updates.title = t;
    }
    if ("author" in body) {
      updates.author = typeof body.author === "string" && body.author.trim() ? body.author.trim() : null;
    }
    if (typeof body.category === "string") {
      updates.category = body.category.trim() || "Other";
    }
    if (Array.isArray(body.languages)) {
      const langs = body.languages
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean);
      if (langs.length === 0) {
        return wrap(jsonResponse({ error: "At least one language is required." }, 400));
      }
      updates.languages = langs;
    }
    if ("description" in body) {
      updates.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    }
    if (typeof body.slug === "string" && body.slug.trim()) {
      const newSlug = slugify(body.slug);
      // Guard against collisions with other books before saving.
      const { data: dupe } = await supabase
        .from("library_books")
        .select("id")
        .eq("slug", newSlug)
        .neq("id", id)
        .maybeSingle();
      if (dupe) {
        return wrap(jsonResponse({ error: `Slug "${newSlug}" is already in use.` }, 409));
      }
      updates.slug = newSlug;
    }
    if (typeof body.public_access === "boolean") {
      updates.public_access = body.public_access;
    }
    if (typeof body.hidden === "boolean") {
      updates.hidden = body.hidden;
    }
    // Backfill of extracted text, sent by the admin page after pulling
    // it out of an already-uploaded PDF in the browser. text_status
    // records a scan ('empty') or a failure ('error') just as clearly as
    // a success, so the backfill doesn't retry the same book forever.
    if (typeof body.text_content === "string" || typeof body.text_status === "string") {
      const text = typeof body.text_content === "string"
        ? body.text_content.slice(0, MAX_TEXT_CHARS).trim()
        : "";
      const status = typeof body.text_status === "string" && body.text_status
        ? body.text_status
        : text ? "ok" : "empty";
      updates.text_content = text || null;
      updates.text_chars = text.length;
      updates.text_status = status;
      updates.text_pages = typeof body.text_pages === "number" ? body.text_pages : 0;
      updates.text_extracted_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) {
      return wrap(jsonResponse({ error: "No editable fields supplied." }, 400));
    }

    const { data: updated, error } = await supabase
      .from("library_books")
      .update(updates)
      .eq("id", id)
      .select("id, slug, title, author, category, languages, description, pdf_storage_key, public_access, hidden, text_chars, text_status, text_pages, created_at, updated_at")
      .single();

    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    if (!updated) return wrap(jsonResponse({ error: "Book not found." }, 404));

    return wrap(jsonResponse({ book: updated }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================
// DELETE — remove book row + its PDF
// ============================================================
export async function onRequestDelete(context: PagesContext): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const id = (context.params.id ?? "").trim();
    if (!id) return wrap(jsonResponse({ error: "Missing book id." }, 400));

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!(await isAdmin(supabase, session.user.id))) {
      return wrap(jsonResponse({ error: "Forbidden" }, 403));
    }

    // Read the storage key first so we know what file to delete from
    // the bucket once the row is gone.
    const { data: existing, error: lookupError } = await supabase
      .from("library_books")
      .select("pdf_storage_key")
      .eq("id", id)
      .single();
    if (lookupError) return wrap(jsonResponse({ error: lookupError.message }, 404));

    const { error: deleteError } = await supabase
      .from("library_books")
      .delete()
      .eq("id", id);
    if (deleteError) return wrap(jsonResponse({ error: deleteError.message }, 500));

    // Best-effort PDF removal — if it fails the book is already gone
    // from the catalog, which is the user-visible outcome they wanted.
    // A stray blob in the bucket is harmless and easy to clean up
    // later in the Supabase dashboard.
    if (existing?.pdf_storage_key) {
      await supabase.storage.from(BUCKET).remove([existing.pdf_storage_key]);
    }

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
