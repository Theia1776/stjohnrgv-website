/**
 * Cloudflare Pages Function: /api/admin/email
 *
 *  GET  — the parish roster (every registered account, name + email)
 *         plus the last 20 messages sent from /admin/email/.
 *  POST — send a message to one member, several, or the whole parish.
 *
 * Who receives it
 * ---------------
 * Everyone who holds an account. Registration required an email
 * address and constituted permission for the parish to write to them,
 * so this endpoint deliberately does NOT filter on
 * profiles.opt_in_communications — that flag governs the automatic
 * announcements (e.g. a new catechism lesson), not an admin writing to
 * the parish directly.
 *
 * How addresses are protected
 * ---------------------------
 * A message with more than one recipient is addressed TO the sending
 * admin, with every member on BCC. Nobody ever sees another member's
 * address — a member who kept their email out of the parish directory
 * keeps it out of this too. Resend caps to + cc + bcc at 50 addresses
 * per message, so the BCC list is sent in batches of 50.
 *
 * The roster itself is not copied into any table: auth.users is the
 * single source of truth, so a member who changes their address is
 * written to at the new one on the very next send.
 *
 * POST body (JSON):
 *   subject    string, required
 *   body       string, required — plain text; blank lines become paragraphs
 *   audience   "everyone" | "individuals"
 *   ids        string[] — profile ids, required when audience is
 *              "individuals"
 *
 * Admin-only, same role check as the rest of /api/admin/*.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { sendEmail } from "../../../src/lib/email";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  RESET_EMAIL_FROM?: string;
  NOTIFY_EMAIL_FROM?: string;
}

// Resend allows 50 addresses across to + cc + bcc on one message. The
// visible To (the sending admin) occupies one of them.
const BCC_BATCH_SIZE = 49;
// Resend's lower tiers allow roughly 2 requests a second.
const BATCH_GAP_MS = 600;
// A parish-sized guard rail. Far above the real roster; raise it if the
// parish ever outgrows it.
const MAX_RECIPIENTS = 1000;

interface Member {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text body → simple HTML: blank lines part paragraphs, single
 *  newlines become line breaks. No markup is accepted from the form, so
 *  everything is escaped first. */
function bodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function requireAdmin(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ ok: boolean; name: string }> {
  const { data } = await supabase
    .from("profiles")
    .select("role, first_name, last_name")
    .eq("id", userId)
    .single();
  if (data?.role !== "admin") return { ok: false, name: "" };
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return { ok: true, name };
}

/**
 * Every registered account, joined to auth.users for the address the
 * person signed up with. Mirrors the join in /api/admin/contacts.
 */
async function loadRoster(supabase: ReturnType<typeof createClient>): Promise<{
  members: Member[];
  error?: string;
}> {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, full_name, role")
    .order("last_name", { ascending: true });
  if (profilesError) return { members: [], error: profilesError.message };

  const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authError) return { members: [], error: authError.message };

  const emailById: Record<string, string> = {};
  for (const u of authData?.users ?? []) {
    if (u.id && u.email) emailById[u.id] = u.email;
  }

  const members = (profiles ?? [])
    .map((p) => {
      const id = p.id as string;
      const name =
        [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
        (p.full_name as string | null) ||
        "";
      return { id, name, email: emailById[id] ?? "", role: (p.role as string | null) ?? null };
    })
    // An account with no address can't be written to; leaving it out
    // keeps the counts on the page honest.
    .filter((m) => m.email);

  return { members };
}

// ============================================================
// GET — roster + recent sends
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
    const admin = await requireAdmin(supabase, session.user.id);
    if (!admin.ok) return wrap(jsonResponse({ error: "Forbidden" }, 403));

    const { members, error } = await loadRoster(supabase);
    if (error) return wrap(jsonResponse({ error }, 500));

    const { data: recent } = await supabase
      .from("parish_emails")
      .select("id, subject, audience, recipient_count, attempted_count, error, sent_by_name, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    return wrap(
      jsonResponse(
        {
          members,
          recent: recent ?? [],
          // The page shows this so an admin knows where replies will go.
          sender_email: session.user.email ?? "",
          email_configured: Boolean(
            context.env.RESEND_API_KEY && (context.env.NOTIFY_EMAIL_FROM || context.env.RESET_EMAIL_FROM),
          ),
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================
// POST — send
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
    const admin = await requireAdmin(supabase, session.user.id);
    if (!admin.ok) return wrap(jsonResponse({ error: "Forbidden" }, 403));

    const apiKey = context.env.RESEND_API_KEY;
    const from = context.env.NOTIFY_EMAIL_FROM || context.env.RESET_EMAIL_FROM;
    if (!apiKey || !from) {
      return wrap(
        jsonResponse(
          { error: "Email isn't set up on the server (RESEND_API_KEY / RESET_EMAIL_FROM)." },
          500,
        ),
      );
    }

    // The sending admin is the visible To on every message and the
    // Reply-To, so replies reach a person rather than the no-reply box.
    const senderEmail = session.user.email ?? "";
    if (!senderEmail) {
      return wrap(jsonResponse({ error: "Your account has no email address to send from." }, 400));
    }

    let payload: Record<string, unknown>;
    try {
      payload = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    const audience = payload.audience === "individuals" ? "individuals" : "everyone";
    const ids = Array.isArray(payload.ids)
      ? payload.ids.filter((x): x is string => typeof x === "string")
      : [];

    if (!subject) return wrap(jsonResponse({ error: "Subject is required." }, 400));
    if (!body) return wrap(jsonResponse({ error: "Message is required." }, 400));
    if (audience === "individuals" && ids.length === 0) {
      return wrap(jsonResponse({ error: "Pick at least one person to write to." }, 400));
    }

    const { members, error: rosterError } = await loadRoster(supabase);
    if (rosterError) return wrap(jsonResponse({ error: rosterError }, 500));

    const chosen =
      audience === "individuals" ? members.filter((m) => ids.includes(m.id)) : members;

    if (chosen.length === 0) {
      return wrap(jsonResponse({ error: "None of those people have an email address on file." }, 400));
    }
    if (chosen.length > MAX_RECIPIENTS) {
      return wrap(jsonResponse({ error: `That's more than ${MAX_RECIPIENTS} recipients.` }, 400));
    }

    const html = bodyToHtml(body);
    const failures: string[] = [];
    let delivered = 0;

    if (chosen.length === 1) {
      // One recipient: address it to them directly. A lone BCC would
      // arrive looking like it was meant for somebody else.
      const result = await sendEmail({
        apiKey,
        from,
        to: chosen[0].email,
        replyTo: senderEmail,
        subject,
        text: body,
        html,
      });
      if (result.ok) delivered = 1;
      else failures.push(result.error ?? "unknown error");
    } else {
      // Several or everyone: TO the admin, everyone else BCC, in
      // batches of 49 so no message exceeds Resend's 50-address cap.
      const addresses = chosen.map((m) => m.email);
      for (let i = 0; i < addresses.length; i += BCC_BATCH_SIZE) {
        const batch = addresses.slice(i, i + BCC_BATCH_SIZE);
        const result = await sendEmail({
          apiKey,
          from,
          to: senderEmail,
          bcc: batch,
          replyTo: senderEmail,
          subject,
          text: body,
          html,
        });
        if (result.ok) delivered += batch.length;
        else failures.push(result.error ?? "unknown error");

        if (i + BCC_BATCH_SIZE < addresses.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_GAP_MS));
        }
      }
    }

    const errorText = failures.length ? failures.join("; ").slice(0, 500) : null;

    // Record the send whether or not it fully succeeded — a failed
    // attempt is exactly the thing an admin needs to see later. A
    // logging failure (e.g. migration 013 not yet applied) must never
    // fail the request: the mail has already gone. It's reported back
    // so an empty "Recently Sent" list isn't a mystery.
    const { error: logError } = await supabase.from("parish_emails").insert({
      sent_by: session.user.id,
      sent_by_name: admin.name || null,
      subject,
      body,
      audience,
      recipient_count: delivered,
      attempted_count: chosen.length,
      error: errorText,
    });

    if (delivered === 0) {
      return wrap(
        jsonResponse({ error: `Nothing was sent. ${errorText ?? ""}`.trim(), attempted: chosen.length }, 502),
      );
    }

    return wrap(
      jsonResponse(
        {
          ok: true,
          delivered,
          attempted: chosen.length,
          error: errorText,
          audience,
          log_error: logError?.message ?? null,
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
