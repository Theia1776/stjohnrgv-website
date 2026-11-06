/**
 * Cloudflare Pages Function: /api/admin/newsletter
 *
 *   GET  — every issue, drafts first. Drafts are what someone opening
 *          this page is here to finish.
 *   POST — start a new issue. It is created as a draft, never
 *          published and never sent: writing and sending are separate
 *          presses so that nothing goes to the whole parish because a
 *          form was submitted twice.
 *
 * Admin-only, same role check as the rest of /api/admin/*.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { MAX_BODY, cleanSections, slugifyIssue } from "../../../../src/lib/newsletter";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const FIELDS =
  "id, slug, title, issue_label, intro, sections, closing, audience, published, " +
  "published_at, sent_at, sent_count, sent_attempted, send_error, written_by_name, " +
  "hero_image, hero_image_alt, created_at, updated_at";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function requireAdmin(context: { request: Request; env: Env }) {
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
    .select("role, first_name, last_name, full_name")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return { error: wrap(jsonResponse({ error: "Forbidden" }, 403)) };

  const name =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
    (profile.full_name as string | null) ||
    "";
  return { supabase, wrap, userId: session.user.id, name };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  try {
    const { data, error } = await gate
      .supabase!.from("newsletters")
      .select(FIELDS)
      // Drafts first, then newest. The draft is the job.
      .order("published", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return gate.wrap!(jsonResponse({ error: error.message }, 500));

    const issues = data ?? [];
    return gate.wrap!(
      jsonResponse(
        {
          issues,
          drafts: issues.filter((i) => !i.published).length,
          email_configured: Boolean((context.env as Env & { RESEND_API_KEY?: string }).RESEND_API_KEY),
        },
        200,
      ),
    );
  } catch (err) {
    return gate.wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  try {
    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return gate.wrap!(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!title) return gate.wrap!(jsonResponse({ error: "The issue needs a title." }, 400));

    // Two issues can share a title — "November" comes round every
    // year — so the second gets a suffix rather than a refusal.
    let slug = slugifyIssue(title);
    const { data: taken } = await gate
      .supabase!.from("newsletters")
      .select("slug")
      .eq("slug", slug)
      .maybeSingle();
    if (taken) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    const { data, error } = await gate
      .supabase!.from("newsletters")
      .insert({
        slug,
        title,
        issue_label: typeof body.issue_label === "string" ? body.issue_label.trim().slice(0, 100) || null : null,
        intro: typeof body.intro === "string" ? body.intro.trim().slice(0, MAX_BODY) || null : null,
        sections: cleanSections(body.sections),
        closing: typeof body.closing === "string" ? body.closing.trim().slice(0, MAX_BODY) || null : null,
        hero_image: typeof body.hero_image === "string" ? body.hero_image.trim() || null : null,
        hero_image_alt:
          typeof body.hero_image_alt === "string" ? body.hero_image_alt.trim() || null : null,
        // The careful default. An issue is parish-only until somebody
        // decides otherwise about that particular issue.
        audience: body.audience === "public" ? "public" : "parish",
        published: false,
        written_by: gate.userId,
        written_by_name: gate.name || null,
      })
      .select(FIELDS)
      .single();

    if (error) return gate.wrap!(jsonResponse({ error: error.message }, 500));
    return gate.wrap!(jsonResponse({ issue: data }, 201));
  } catch (err) {
    return gate.wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
