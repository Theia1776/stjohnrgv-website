/**
 * Cloudflare Pages Function: GET /api/catechism/text?slug=<lesson slug>
 *
 * The extracted text of one lesson — the reflowing "Text" view in the
 * lesson reader, and what a citation is taken from. The text was pulled
 * out of the PDF once, in an admin's browser at upload (migration 017).
 * The original PDF is untouched and still served by /api/catechism/pdf.
 *
 * Visibility matches the PDF endpoint exactly, so the text view can
 * never become a way around it:
 *   - Signed-in members: any posted lesson.
 *   - Drafts: admins only.
 *   - Logged-out visitors: nothing. Catechism lessons are never public.
 *
 * Response:
 *   200 { slug, title, teacher, series, lesson_date, text, chars, pages }
 *   400 { error }   — missing ?slug
 *   401 { error }   — not signed in
 *   403 { error }   — a draft, and the viewer isn't an admin
 *   404 { error }   — no such lesson
 *   409 { error }   — lesson exists but has no text (a scan, or never
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

  if (!session.user) {
    return wrap(jsonResponse({ error: "Please sign in to read this lesson." }, 401));
  }
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: lesson, error } = await admin
    .from("catechism_lessons")
    .select(
      "slug, title, teacher, series, lesson_date, published, text_content, text_chars, text_status, text_pages",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) return wrap(jsonResponse({ error: error.message }, 500));
  if (!lesson) return wrap(jsonResponse({ error: "Lesson not found." }, 404));

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

  if (!lesson.text_content || lesson.text_status !== "ok") {
    return wrap(
      jsonResponse(
        {
          error:
            lesson.text_status === "empty"
              ? "This lesson is a scan of printed pages, so there is no text to pull out. Read it in page view."
              : "A text version of this lesson hasn't been prepared yet. Read it in page view.",
        },
        409,
      ),
    );
  }

  return wrap(
    jsonResponse(
      {
        slug: lesson.slug,
        title: lesson.title,
        teacher: lesson.teacher,
        series: lesson.series,
        lesson_date: lesson.lesson_date,
        text: lesson.text_content,
        chars: lesson.text_chars ?? String(lesson.text_content).length,
        pages: lesson.text_pages ?? 0,
      },
      200,
    ),
  );
}
