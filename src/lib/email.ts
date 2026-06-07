/**
 * Transactional email via Resend (https://resend.com).
 *
 * Resend exposes a simple REST API that works from Cloudflare Pages
 * Functions with a plain `fetch` — no SDK needed. We use it for the
 * one and only member-facing email the site sends: the password-reset
 * code. (Contact-form and registration notices go to the parish office
 * through Formspree, a separate path.)
 *
 * Config comes from two Cloudflare env vars (set in the Pages
 * dashboard, never in the repo):
 *   - RESEND_API_KEY    — the secret API key from the Resend dashboard.
 *   - RESET_EMAIL_FROM  — the From address, e.g.
 *       "St. John of Kronstadt <no-reply@stjohnrgv.org>".
 *       The domain must be verified in Resend first (add the DNS
 *       records Resend gives you). Until then, Resend's sandbox only
 *       delivers to the account owner's own address.
 */

export interface SendEmailParams {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Present on failure — a short reason for the server log. */
  error?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { apiKey, from, to, subject, text, html } = params;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
    });

    if (!res.ok) {
      // Resend returns a JSON body with a message on error; fall back to
      // the status text if it isn't JSON.
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${detail || res.statusText}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
