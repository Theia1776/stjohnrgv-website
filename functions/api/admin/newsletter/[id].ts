/**
 * Cloudflare Pages Function: /api/admin/newsletter/:id
 *
 *   PATCH  — edit an issue, publish it, un-publish it, or change who
 *            may read it.
 *   DELETE — remove it.
 *
 * Publishing stamps `published_at` the first time only. An issue
 * un-published to fix a typo and published again keeps its original
 * date, because that is when the parish received it, and the back
 * issues are ordered by it.
 *
 * Admin-only.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { MAX_BODY, cleanSections } from "../../../../src/lib/newsletter";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const FIELDS =
  "id, slug, title, issue_label, intro, sections, closing, audience, published, " +
  "published_at, sent_at, sent_count, sent_attempted, send_error, written_by_name, " +
  "hero_image, hero_image_alt, attachment_key, attachment_name, attachment_bytes, " +
  "created_at, updated_at";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function requireAdmin(context: { request: Request; env: Env }) {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) return { error: wrap(jsonResponse({ error: "Unauthorized" }, 401)) };
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: wrap(jsonResponse({ error: "Server not configured." }, 500)) };
  }
  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return { error: wrap(jsonResponse({ error: "Forbidden" }, 403)) };
  return { supabase, wrap };
}

interface PagesContext {
  request: Request;
  env: Env;
  params: { id: string };
}

export async function onRequestPatch(context: PagesContext): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const { supabase, wrap } = gate;

  try {
    const id = (context.params.id ?? "").trim();
    if (!id) return wrap!(jsonResponse({ error: "Missing issue id." }, 400));

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap!(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const updates: Record<string, unknown> = {};

    if (typeof body.title === "string") {
      const title = body.title.trim().slice(0, 200);
      if (!title) return wrap!(jsonResponse({ error: "The title cannot be empty." }, 400));
      updates.title = title;
    }
    if ("issue_label" in body) {
      updates.issue_label =
        typeof body.issue_label === "string" ? body.issue_label.trim().slice(0, 100) || null : null;
    }
    // The photograph under the masthead, and the PDF that goes out
    // attached to the email. Both stored as R2 keys.
    for (const field of ["hero_image", "hero_image_alt", "attachment_key", "attachment_name"] as const) {
      if (field in body) {
        updates[field] = typeof body[field] === "string" ? (body[field] as string).trim() || null : null;
      }
    }
    if ("attachment_bytes" in body) {
      const n = Number(body.attachment_bytes);
      updates.attachment_bytes = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    for (const field of ["intro", "closing"] as const) {
      if (field in body) {
        updates[field] =
          typeof body[field] === "string" ? (body[field] as string).trim().slice(0, MAX_BODY) || null : null;
      }
    }
    if ("sections" in body) {
      updates.sections = cleanSections(body.sections);
    }
    if ("audience" in body) {
      const audience = String(body.audience ?? "");
      if (audience !== "parish" && audience !== "public") {
        return wrap!(jsonResponse({ error: "Audience must be 'parish' or 'public'." }, 400));
      }
      updates.audience = audience;
    }

    if (typeof body.published === "boolean") {
      updates.published = body.published;
      if (body.published) {
        // Stamped once. Un-publishing to fix a typo and publishing
        // again must not move the issue to the top of the back issues
        // as though it were new.
        const { data: existing } = await supabase!
          .from("newsletters")
          .select("published_at")
          .eq("id", id)
          .single();
        if (!existing?.published_at) updates.published_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return wrap!(jsonResponse({ error: "Nothing to change." }, 400));
    }

    const { data, error } = await supabase!
      .from("newsletters")
      .update(updates)
      .eq("id", id)
      .select(FIELDS)
      .single();
    if (error) return wrap!(jsonResponse({ error: error.message }, 500));
    if (!data) return wrap!(jsonResponse({ error: "No such issue." }, 404));

    return wrap!(jsonResponse({ issue: data }, 200));
  } catch (err) {
    return wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}

export async function onRequestDelete(context: PagesContext): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const { supabase, wrap } = gate;

  try {
    const id = (context.params.id ?? "").trim();
    if (!id) return wrap!(jsonResponse({ error: "Missing issue id." }, 400));

    // An issue that has gone out cannot be unsent, and deleting it
    // breaks the "read it online" link in every copy sitting in a
    // parishioner's inbox. Un-publishing takes the page down without
    // that; deleting is for drafts and mistakes.
    const { data: existing } = await supabase!
      .from("newsletters")
      .select("sent_at")
      .eq("id", id)
      .single();
    if (existing?.sent_at) {
      return wrap!(
        jsonResponse(
          {
            error:
              "This issue has already been emailed, and every copy links back " +
              "to its page. Un-publish it instead — that takes the page down " +
              "without breaking those links.",
          },
          409,
        ),
      );
    }

    const { error } = await supabase!.from("newsletters").delete().eq("id", id);
    if (error) return wrap!(jsonResponse({ error: error.message }, 500));
    return wrap!(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
