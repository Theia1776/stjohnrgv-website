/**
 * Cloudflare Pages Function: /api/admin/library
 *
 *  GET  — list every library book for the admin manage view.
 *  POST — create a new book and upload its PDF.
 *
 * The POST body is multipart/form-data with these fields:
 *   pdf          (File, required)           — the actual PDF
 *   slug         (string, optional)         — URL slug; auto-derived
 *                                             from title when missing
 *   title        (string, required)
 *   author       (string, optional)
 *   category     (string, required)
 *   languages    (string, required)         — comma-separated list,
 *                                             e.g. "English,Greek"
 *   description  (string, optional)
 *
 * On success the row is inserted into library_books and the PDF is
 * uploaded to the existing "library" storage bucket under the file's
 * original name (or a de-duplicated variant if the name is taken).
 * The pdf_storage_key column stores the exact bucket key so the
 * reader page can sign URLs through /api/library/pdf.
 *
 * Admin-only. Mirrors the role-check pattern in
 * functions/api/admin/directory.ts and friends.
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const BUCKET = "library";
// Books often run 5-30 MB; cap at 50 MB to avoid runaway uploads
// from misclicks (e.g. someone dragging the wrong scanned PDF).
const PDF_MAX_BYTES = 50 * 1024 * 1024;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Strip diacritics, lowercase, swap non-alphanumerics for hyphens, and
// collapse repeats. Keeps slugs short and URL-safe.
function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function parseLanguages(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function isAdmin(supabase: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  return data?.role === "admin";
}

// ============================================================
// GET — list every book (admin view)
// ============================================================
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!(await isAdmin(supabase, session.user.id))) {
      return wrap(jsonResponse({ error: "Forbidden" }, 403));
    }

    const { data, error } = await supabase
      .from("library_books")
      .select("id, slug, title, author, category, languages, description, pdf_storage_key, public_access, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ books: data ?? [] }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================
// POST — create new book + upload PDF
// ============================================================
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!(await isAdmin(supabase, session.user.id))) {
      return wrap(jsonResponse({ error: "Forbidden" }, 403));
    }

    let formData: FormData;
    try {
      formData = await context.request.formData();
    } catch {
      return wrap(jsonResponse({ error: "Expected multipart/form-data." }, 400));
    }

    const pdfFile = formData.get("pdf");
    if (!(pdfFile instanceof File)) {
      return wrap(jsonResponse({ error: "PDF file is required." }, 400));
    }
    if (pdfFile.type && pdfFile.type !== "application/pdf") {
      return wrap(jsonResponse({ error: "Upload must be a PDF." }, 400));
    }
    if (pdfFile.size === 0) {
      return wrap(jsonResponse({ error: "PDF is empty." }, 400));
    }
    if (pdfFile.size > PDF_MAX_BYTES) {
      return wrap(jsonResponse({ error: `PDF must be under ${PDF_MAX_BYTES / 1024 / 1024} MB.` }, 400));
    }

    const title = String(formData.get("title") ?? "").trim();
    const author = String(formData.get("author") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim() || "Other";
    const languagesRaw = String(formData.get("languages") ?? "English").trim();
    const description = String(formData.get("description") ?? "").trim();
    const slugRaw = String(formData.get("slug") ?? "").trim();
    // Checkboxes submit "on" when checked, nothing when unchecked.
    const publicAccess = formData.get("public_access") != null;

    if (!title) return wrap(jsonResponse({ error: "Title is required." }, 400));

    const languages = parseLanguages(languagesRaw);
    if (languages.length === 0) {
      return wrap(jsonResponse({ error: "At least one language is required." }, 400));
    }

    const slug = slugRaw ? slugify(slugRaw) : slugify(title);

    // Reject before upload if the slug is already taken — saves a
    // bucket write that we'd just have to clean up.
    const { data: dupe } = await supabase
      .from("library_books")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (dupe) {
      return wrap(jsonResponse({ error: `A book with the slug "${slug}" already exists.` }, 409));
    }

    // Storage key: prefer the file's original name so admins recognise
    // what's in the bucket. If something with that name is already
    // there we suffix with a UUID slice so we never overwrite an
    // existing book's PDF by accident.
    const originalName = pdfFile.name || `${slug}.pdf`;
    let storageKey = originalName;
    const { data: existingFiles } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 1000, search: originalName });
    if (existingFiles?.some((f) => f.name === originalName)) {
      const suffix = crypto.randomUUID().slice(0, 8);
      const dot = originalName.lastIndexOf(".");
      storageKey = dot > 0
        ? `${originalName.slice(0, dot)}-${suffix}${originalName.slice(dot)}`
        : `${originalName}-${suffix}`;
    }

    const buffer = await pdfFile.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, buffer, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      return wrap(jsonResponse({ error: `PDF upload failed: ${uploadError.message}` }, 500));
    }

    const { data: inserted, error: insertError } = await supabase
      .from("library_books")
      .insert({
        slug,
        title,
        author: author || null,
        category,
        languages,
        description: description || null,
        pdf_storage_key: storageKey,
        public_access: publicAccess,
      })
      .select("id, slug, title, author, category, languages, description, pdf_storage_key, public_access, created_at, updated_at")
      .single();

    if (insertError) {
      // Roll back the uploaded PDF so we don't leave an orphan blob
      // in the bucket when the row insert fails (duplicate key, etc.).
      await supabase.storage.from(BUCKET).remove([storageKey]);
      return wrap(jsonResponse({ error: `Could not save book: ${insertError.message}` }, 500));
    }

    return wrap(jsonResponse({ book: inserted }, 201));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
