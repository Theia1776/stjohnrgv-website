/**
 * Cloudflare Pages Function: POST /api/admin/newsletter/send
 *
 * Email a published issue to the parish.
 *
 * The same rules as /api/admin/email, because they are the rules that
 * protect people rather than conveniences:
 *   - everyone with an account receives it; registration was the
 *     permission to write to them
 *   - more than one recipient means the parish address on the To and
 *     everybody on BCC, in batches of 49, because recipients can read
 *     a To header and nobody may learn another member's address
 *   - it goes out as the office or as Fr. Antonios, never as the
 *     personal mailbox of whoever pressed send
 *
 * Two guards this endpoint adds, both learned the hard way elsewhere:
 *
 *   An issue must be **published** before it can be sent. The email
 *   carries a link to its page, and sending a draft would post a link
 *   to a page that answers 404 to the whole parish.
 *
 *   An issue that has already been sent is refused unless `again` is
 *   explicitly true. A double press on a slow phone should not send
 *   the newsletter twice to every household.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { sendEmail } from "../../../../src/lib/email";
import { issueToHtml, issueToText } from "../../../../src/lib/newsletter";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  PARISH_OFFICE_EMAIL?: string;
  PRIEST_EMAIL?: string;
}

/** The two parish identities, as in functions/api/admin/email.ts. */
const SENDERS = {
  office: {
    label: "The parish office",
    name: "St. John of Kronstadt Orthodox Mission",
    address: "parishoffice@stjohnrgv.org",
  },
  priest: {
    label: "Fr. Antonios",
    name: "Fr. Antonios — St. John of Kronstadt",
    address: "frantonios@stjohnrgv.org",
  },
} as const;
type SenderKey = keyof typeof SENDERS;

function resolveSender(env: Env, key: SenderKey): { from: string; address: string } {
  const sender = SENDERS[key];
  const address = (key === "priest" ? env.PRIEST_EMAIL : env.PARISH_OFFICE_EMAIL) || sender.address;
  return { from: `${sender.name} <${address}>`, address };
}

const BCC_BATCH_SIZE = 49;
const BATCH_GAP_MS = 600;
const MAX_RECIPIENTS = 1000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Every account with an address, from auth.users — one source of truth. */
async function loadAddresses(
  supabase: ReturnType<typeof createClient>,
): Promise<{ addresses: string[]; error?: string }> {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) return { addresses: [], error: error.message };
  const addresses = (data?.users ?? [])
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));
  return { addresses: Array.from(new Set(addresses)) };
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

    const apiKey = context.env.RESEND_API_KEY;
    if (!apiKey) {
      return wrap(jsonResponse({ error: "Email isn't set up on the server (RESEND_API_KEY)." }, 500));
    }

    let payload: Record<string, unknown>;
    try {
      payload = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Which issue?" }, 400));
    const senderKey: SenderKey = payload.sender === "priest" ? "priest" : "office";
    const sender = resolveSender(context.env, senderKey);
    const again = payload.again === true;

    const { data: issue, error: loadError } = await supabase
      .from("newsletters")
      .select("id, slug, title, issue_label, intro, sections, closing, published, published_at, sent_at, sent_count, hero_image, hero_image_alt, attachment_key, attachment_name, attachment_bytes")
      .eq("id", id)
      .single();
    if (loadError) return wrap(jsonResponse({ error: loadError.message }, 500));
    if (!issue) return wrap(jsonResponse({ error: "No such issue." }, 404));

    if (!issue.published) {
      return wrap(
        jsonResponse(
          {
            error:
              "Publish it first. The email carries a link to the issue's page, " +
              "and sending now would post a dead link to the whole parish.",
          },
          409,
        ),
      );
    }

    if (issue.sent_at && !again) {
      return wrap(
        jsonResponse(
          {
            error:
              `This issue already went out to ${issue.sent_count} ` +
              `${issue.sent_count === 1 ? "person" : "people"}. Sending again will ` +
              "deliver a second copy to everyone.",
            already_sent: true,
            sent_at: issue.sent_at,
            sent_count: issue.sent_count,
          },
          409,
        ),
      );
    }

    const { addresses, error: rosterError } = await loadAddresses(supabase);
    if (rosterError) return wrap(jsonResponse({ error: rosterError }, 500));
    if (addresses.length === 0) {
      return wrap(jsonResponse({ error: "Nobody on the roster has an email address." }, 400));
    }
    if (addresses.length > MAX_RECIPIENTS) {
      return wrap(jsonResponse({ error: `That's more than ${MAX_RECIPIENTS} recipients.` }, 400));
    }

    const subject = issue.issue_label ? `${issue.issue_label} — ${issue.title}` : issue.title;
    const text = issueToText(issue);
    const html = issueToHtml(issue);

    // The PDF, if this issue has one. Resend fetches the URL itself,
    // so the file never passes through this Function — which is the
    // only way a twenty-megabyte attachment is sendable from here at
    // all. The URL is built from the request's own origin so it works
    // the same on a preview deployment as on the live site.
    const attachments = issue.attachment_key
      ? [
          {
            filename: issue.attachment_name || "Newsletter.pdf",
            path:
              `${new URL(context.request.url).origin}/api/newsletter/file` +
              `?key=${encodeURIComponent(issue.attachment_key)}`,
          },
        ]
      : undefined;

    const failures: string[] = [];
    let delivered = 0;

    for (let i = 0; i < addresses.length; i += BCC_BATCH_SIZE) {
      const batch = addresses.slice(i, i + BCC_BATCH_SIZE);
      const result = await sendEmail({
        apiKey,
        from: sender.from,
        // The parish address on the To, always. People on BCC can read
        // it, so anything else publishes someone's address to the list.
        to: sender.address,
        bcc: batch,
        replyTo: sender.address,
        subject,
        text,
        html,
        attachments,
      });
      if (result.ok) delivered += batch.length;
      else failures.push(result.error ?? "unknown error");

      if (i + BCC_BATCH_SIZE < addresses.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_GAP_MS));
      }
    }

    const errorText = failures.length ? failures.join("; ").slice(0, 500) : null;

    // Recorded whether or not it fully worked — a partial send is
    // exactly what someone needs to see a week later. A failure to
    // record must not fail the request: the mail has already gone.
    const { error: logError } = await supabase
      .from("newsletters")
      .update({
        sent_at: new Date().toISOString(),
        sent_count: delivered,
        sent_attempted: addresses.length,
        send_error: errorText,
      })
      .eq("id", id);

    if (delivered === 0) {
      return wrap(
        jsonResponse(
          { error: `Nothing was sent. ${errorText ?? ""}`.trim(), attempted: addresses.length },
          502,
        ),
      );
    }

    return wrap(
      jsonResponse(
        {
          ok: true,
          delivered,
          attempted: addresses.length,
          error: errorText,
          sent_as: senderKey,
          sender_address: sender.address,
          log_error: logError?.message ?? null,
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
