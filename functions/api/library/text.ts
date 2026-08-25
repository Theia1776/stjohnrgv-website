/**
 * Cloudflare Pages Function: GET /api/library/text?slug=<book slug>
 *
 * The cleaned-up text of one book — the reflowing "Text" view in the
 * reader. The text was extracted from the PDF once, in an admin's
 * browser at upload time, and stored on the book's row (migration 015).
 * The original PDF is untouched and still served by /api/library/pdf.
 *
 * Visibility matches the PDF endpoint exactly, so the text view can
 * never become a way around it:
 *   - Logged-in parishioners: any non-hidden book.
 *   - Anonymous visitors: only books marked public.
 *   - Hidden (staging) books: admins only.
 *
 * Response:
 *   200 { slug, title, author, text, chars }
 *   400 { error }   — missing ?slug
 *   403 { error }   — not allowed to read this book
 *   404 { error }   — no such book
 *   409 { error }   — book exists but has no text (a scan, or never
 *                     extracted) — the reader says so and offers the
 *                     page view instead
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
    .select("slug, title, author, public_access, hidden, text_content, text_chars, text_status")
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

  if (!book.text_content || book.text_status !== "ok") {
    return wrap(
      jsonResponse(
        {
          error:
            book.text_status === "empty"
              ? "This book is a scan of printed pages, so there is no text to pull out. Read it in page view."
              : "A text version of this book hasn't been prepared yet. Read it in page view.",
        },
        409,
      ),
    );
  }

  return wrap(
    jsonResponse(
      {
        slug: book.slug,
        title: book.title,
        author: book.author,
        text: book.text_content,
        chars: book.text_chars ?? String(book.text_content).length,
      },
      200,
    ),
  );
}
