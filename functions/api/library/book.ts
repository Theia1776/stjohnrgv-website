/**
 * Cloudflare Pages Function: GET /api/library/book?slug=<slug>
 *
 * One book's details, for the reader page.
 *
 * The reader used to find its book by scanning the whole catalog from
 * /api/library/books. That had two problems: the catalog never includes
 * hidden (staging) books, so an admin opening one from /admin/library/
 * was told "Book not found" even though the book was right there; and
 * it hauled every book's metadata across to display one.
 *
 * Visibility matches the PDF and text endpoints exactly:
 *   - Anonymous visitors: public, non-hidden books only.
 *   - Logged-in parishioners: any non-hidden book.
 *   - Hidden (staging) books: admins only.
 *
 * Response:
 *   200 { book: { slug, title, author, category, languages,
 *                 description, pdf_storage_key, has_text, hidden } }
 *   400 { error }   — missing ?slug
 *   403 { error }   — not allowed to read this book
 *   404 { error }   — no book with that slug
 *   500 { error }
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  const url = new URL(context.request.url);
  const slug = url.searchParams.get("slug")?.trim() || "";
  if (!slug) return wrap(jsonResponse({ error: "Missing 'slug' query parameter." }, 400));

  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: book, error } = await admin
    .from("library_books")
    .select(
      "slug, title, author, category, languages, description, pdf_storage_key, public_access, hidden, text_chars, text_status",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) return wrap(jsonResponse({ error: error.message }, 500));
  if (!book) return wrap(jsonResponse({ error: "Book not found." }, 404));

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

  return wrap(
    jsonResponse(
      {
        book: {
          slug: book.slug,
          title: book.title,
          author: book.author,
          category: book.category,
          languages: book.languages,
          description: book.description,
          pdf_storage_key: book.pdf_storage_key,
          hidden: book.hidden,
          has_text: Number(book.text_chars ?? 0) > 0 && book.text_status === "ok",
        },
      },
      200,
    ),
  );
}
