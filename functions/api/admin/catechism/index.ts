/**
 * Cloudflare Pages Function: /api/admin/catechism
 *
 *  GET  — list every lesson (drafts included) for the admin view.
 *  POST — upload a new lesson PDF and post it to member accounts.
 *
 * The POST body is multipart/form-data:
 *   pdf          (File, required)      — the lesson PDF
 *   title        (string, required)
 *   teacher      (string, optional)    — e.g. "Fr. Antonios"
 *   series       (string, optional)    — e.g. "Introduction to the Faith"
 *   lesson_date  (string, optional)    — YYYY-MM-DD, the date of the lesson
 *   description  (string, optional)
 *   slug         (string, optional)    — auto-derived from the title
 *   status       ("posted" | "draft")  — defaults to "posted"
 *   notify       ("1" when checked)    — email members who opted into
 *                                        parish communications
 *
 * The PDF goes into the existing "library" storage bucket under the
 * `catechism/` prefix, so no new bucket is required. Once the row is
 * inserted the lesson appears in every signed-in member's My Learning
 * section on the next page load — no rebuild, no deploy.
 *
 * Admin-only, same role-check pattern as /api/admin/library.
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { sendEmail } from "../../../../src/lib/email";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  RESET_EMAIL_FROM?: string;
  /** Optional override; falls back to RESET_EMAIL_FROM, the address
   *  already verified in Resend for password-reset mail. */
  NOTIFY_EMAIL_FROM?: string;
}

const BUCKET = "library";
const PREFIX = "catechism/";
// Lessons are handouts, not scanned books — 25 MB is generous and
// keeps a misdropped file from stalling the upload.
const PDF_MAX_BYTES = 25 * 1024 * 1024;
// Safety rail on a single announcement so a misconfiguration can't fan
// out endlessly. The parish is far below this; raise it if it grows.
const MAX_NOTIFY_RECIPIENTS = 500;

const LESSON_FIELDS =
  "id, slug, title, teacher, series, lesson_date, description, pdf_storage_key, published, notified_at, created_at, updated_at";

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
    .slice(0, 80) || "lesson";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
// GET — list every lesson, drafts included
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
      .from("catechism_lessons")
      .select(LESSON_FIELDS)
      .order("lesson_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ lessons: data ?? [] }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================
// Email announcement
// ============================================================
interface Recipient {
  email: string;
  first_name: string;
}

/**
 * Everyone who ticked "Receive email updates" in their account.
 * Addresses live in auth.users, so we join the opted-in profiles
 * against auth.admin.listUsers() the same way /api/admin/contacts does.
 */
async function collectRecipients(
  supabase: ReturnType<typeof createClient>,
): Promise<{ recipients: Recipient[]; error?: string }> {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, first_name")
    .eq("opt_in_communications", true);
  if (profilesError) return { recipients: [], error: profilesError.message };

  const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authError) return { recipients: [], error: authError.message };

  const emailById: Record<string, string> = {};
  for (const u of authData?.users ?? []) {
    if (u.id && u.email) emailById[u.id] = u.email;
  }

  const recipients = (profiles ?? [])
    .map((p) => ({
      email: emailById[p.id as string] ?? "",
      first_name: (p.first_name as string | null) ?? "",
    }))
    .filter((r) => r.email)
    .slice(0, MAX_NOTIFY_RECIPIENTS);

  return { recipients };
}

/**
 * Mail the announcement one address at a time, so nobody sees anyone
 * else's email address, with a small gap between sends to stay inside
 * Resend's per-second rate limit.
 *
 * Runs in the background (context.waitUntil) after the upload response
 * has already gone back to the admin — a parish-sized send would
 * otherwise hold the request open for half a minute. The lesson's
 * notified_at column is stamped when at least one message went out, so
 * the admin table's "Emailed" column reflects the result.
 */
async function sendAnnouncements(
  supabase: ReturnType<typeof createClient>,
  mail: { apiKey: string; from: string },
  lesson: { id: string; title: string; teacher: string | null; description: string | null },
  recipients: Recipient[],
  origin: string,
): Promise<void> {
  const accountUrl = `${origin}/account/`;
  const byline = lesson.teacher ? ` from ${lesson.teacher}` : "";
  const blurb = lesson.description ? `\n\n${lesson.description}` : "";
  // Resend's lower tiers allow ~2 requests/second; 600 ms between sends
  // keeps us comfortably under that.
  const GAP_MS = 600;

  let sent = 0;
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const greeting = r.first_name ? `Dear ${r.first_name},` : "Dear friend in Christ,";
    const text =
      `${greeting}\n\n` +
      `A new catechism lesson${byline} has been posted to the parish website: "${lesson.title}".` +
      `${blurb}\n\n` +
      `You can read it any time under "My Learning" in your account:\n${accountUrl}\n\n` +
      `In Christ,\nSt. John of Kronstadt Orthodox Mission`;
    const html =
      `<p>${escapeHtml(greeting)}</p>` +
      `<p>A new catechism lesson${escapeHtml(byline)} has been posted to the parish website: ` +
      `<strong>${escapeHtml(lesson.title)}</strong>.</p>` +
      (lesson.description ? `<p>${escapeHtml(lesson.description)}</p>` : "") +
      `<p>You can read it any time under &ldquo;My Learning&rdquo; in your account:<br>` +
      `<a href="${escapeHtml(accountUrl)}">${escapeHtml(accountUrl)}</a></p>` +
      `<p>In Christ,<br>St. John of Kronstadt Orthodox Mission</p>`;

    const result = await sendEmail({
      apiKey: mail.apiKey,
      from: mail.from,
      to: r.email,
      subject: `New catechism lesson: ${lesson.title}`,
      text,
      html,
    });
    if (result.ok) sent += 1;
    else console.error("Lesson notification failed:", r.email, result.error);

    if (i < recipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
  }

  console.log(`Lesson "${lesson.title}": emailed ${sent} of ${recipients.length} members.`);

  if (sent > 0) {
    await supabase
      .from("catechism_lessons")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", lesson.id);
  }
}

// ============================================================
// POST — upload a lesson (+ optional member notification)
// ============================================================
export async function onRequestPost(
  context: {
    request: Request;
    env: Env;
    // Present on Cloudflare; typed optional so the handler also works
    // in a plain-fetch test harness. Same shape as auth/forgot.ts.
    waitUntil?: (promise: Promise<unknown>) => void;
  },
): Promise<Response> {
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
    if (pdfFile.size === 0) return wrap(jsonResponse({ error: "PDF is empty." }, 400));
    if (pdfFile.size > PDF_MAX_BYTES) {
      return wrap(jsonResponse({ error: `PDF must be under ${PDF_MAX_BYTES / 1024 / 1024} MB.` }, 400));
    }

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return wrap(jsonResponse({ error: "Title is required." }, 400));

    const teacher = String(formData.get("teacher") ?? "").trim();
    const series = String(formData.get("series") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const slugRaw = String(formData.get("slug") ?? "").trim();
    const status = String(formData.get("status") ?? "posted").trim();
    const published = status !== "draft";
    const notify = String(formData.get("notify") ?? "") === "1";

    // Dates arrive from <input type="date"> as YYYY-MM-DD. Anything
    // else is treated as "no date" rather than failing the upload.
    const lessonDateRaw = String(formData.get("lesson_date") ?? "").trim();
    const lessonDate = /^\d{4}-\d{2}-\d{2}$/.test(lessonDateRaw) ? lessonDateRaw : null;

    const slug = slugRaw ? slugify(slugRaw) : slugify(title);

    // Reject a duplicate slug before uploading so we never have to
    // clean an orphaned blob out of the bucket.
    const { data: dupe } = await supabase
      .from("catechism_lessons")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (dupe) {
      return wrap(jsonResponse({ error: `A lesson with the slug "${slug}" already exists.` }, 409));
    }

    // Storage key keeps the original filename (easy to recognise in the
    // bucket) under the catechism/ prefix, with a short suffix if that
    // name is already taken.
    const originalName = pdfFile.name || `${slug}.pdf`;
    let storageKey = `${PREFIX}${originalName}`;
    const { data: existingFiles } = await supabase.storage
      .from(BUCKET)
      .list(PREFIX.replace(/\/$/, ""), { limit: 1000, search: originalName });
    if (existingFiles?.some((f) => f.name === originalName)) {
      const suffix = crypto.randomUUID().slice(0, 8);
      const dot = originalName.lastIndexOf(".");
      const renamed = dot > 0
        ? `${originalName.slice(0, dot)}-${suffix}${originalName.slice(dot)}`
        : `${originalName}-${suffix}`;
      storageKey = `${PREFIX}${renamed}`;
    }

    const buffer = await pdfFile.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, buffer, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      return wrap(jsonResponse({ error: `PDF upload failed: ${uploadError.message}` }, 500));
    }

    const { data: inserted, error: insertError } = await supabase
      .from("catechism_lessons")
      .insert({
        slug,
        title,
        teacher: teacher || null,
        series: series || null,
        lesson_date: lessonDate,
        description: description || null,
        pdf_storage_key: storageKey,
        published,
      })
      .select(LESSON_FIELDS)
      .single();

    if (insertError) {
      // Roll back the blob so a failed insert doesn't leave a stray PDF.
      await supabase.storage.from(BUCKET).remove([storageKey]);
      return wrap(jsonResponse({ error: `Could not save lesson: ${insertError.message}` }, 500));
    }

    // The announcement is best-effort and never fails the upload — the
    // lesson is already in everyone's account either way. A draft is
    // never announced. Anything that can be checked quickly (config,
    // recipient list) is reported in this response; the sending itself
    // continues in the background.
    let notified: { queued: number; error?: string } | null = null;
    if (notify && published) {
      const apiKey = context.env.RESEND_API_KEY;
      const from = context.env.NOTIFY_EMAIL_FROM || context.env.RESET_EMAIL_FROM;
      if (!apiKey || !from) {
        notified = {
          queued: 0,
          error: "email isn't set up on the server (RESEND_API_KEY / RESET_EMAIL_FROM).",
        };
      } else {
        const { recipients, error: recipientsError } = await collectRecipients(supabase);
        if (recipientsError) {
          notified = { queued: 0, error: recipientsError };
        } else {
          notified = { queued: recipients.length };
          const origin = new URL(context.request.url).origin;
          const send = sendAnnouncements(
            supabase,
            { apiKey, from },
            {
              id: inserted.id as string,
              title,
              teacher: teacher || null,
              description: description || null,
            },
            recipients,
            origin,
          ).catch((e) => console.error("Lesson announcement failed:", e));

          // Don't hold the upload response open for the whole send.
          if (context.waitUntil) context.waitUntil(send);
          else await send;
        }
      }
    }

    return wrap(jsonResponse({ lesson: inserted, notified }, 201));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
