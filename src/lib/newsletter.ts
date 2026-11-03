/**
 * An issue of the parish newsletter, rendered.
 *
 * One issue goes out two ways — as a page on the site and as an email —
 * and this is the one place that turns the stored row into either. If
 * the page and the email were laid out separately they would drift,
 * and the first anyone would know of it is a parishioner saying the
 * email left something out.
 *
 * Nothing here accepts markup. The writer types plain text into the
 * admin form; blank lines part paragraphs and that is the whole of the
 * formatting. Everything is escaped on the way into HTML, so an
 * ampersand in "Bob & Mary" cannot break the email and nothing pasted
 * from elsewhere can smuggle a tag into a parishioner's inbox.
 */

export interface NewsletterSection {
  heading: string;
  body: string;
}

export interface NewsletterIssue {
  slug: string;
  title: string;
  issue_label?: string | null;
  intro?: string | null;
  sections?: NewsletterSection[] | null;
  closing?: string | null;
  published_at?: string | null;
}

export const PARISH = {
  name: "St. John of Kronstadt Orthodox Mission",
  address: "39737 Palm Lane, Bayview, TX 78566",
  phone: "(956) 434-6874",
  site: "https://stjohnrgv.org",
} as const;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugifyIssue(title: string): string {
  return (
    String(title ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "issue"
  );
}

/** Whatever came out of jsonb, as sections with both halves present. */
export function readSections(value: unknown): NewsletterSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => ({
      heading: typeof (s as NewsletterSection)?.heading === "string" ? (s as NewsletterSection).heading.trim() : "",
      body: typeof (s as NewsletterSection)?.body === "string" ? (s as NewsletterSection).body.trim() : "",
    }))
    // A section needs something to say. An empty row is one the writer
    // added and didn't use, and a heading with nothing under it is the
    // same thing half-finished — it would go out to the whole parish
    // as a title followed by blank space, which reads as broken.
    // Dropping both here lets the form be generous about offering rows.
    //
    // A body with NO heading is kept on purpose: an unheaded paragraph
    // between two sections is a normal thing to want.
    .filter((s) => s.body);
}

/** Blank lines part paragraphs; single newlines are line breaks. */
function paragraphs(text: string): string {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 1em;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The date an issue carries, written the way a person would say it. */
export function issueDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The issue as plain text.
 *
 * Not a fallback nobody reads: some people's mail is set to plain text,
 * and a newsletter that arrives as a wall of unsegmented prose for them
 * is a newsletter they stop opening.
 */
export function issueToText(issue: NewsletterIssue): string {
  const lines: string[] = [];
  if (issue.issue_label) lines.push(issue.issue_label.toUpperCase());
  lines.push(issue.title, "=".repeat(Math.min(issue.title.length, 60)), "");
  if (issue.intro) lines.push(issue.intro.trim(), "");

  for (const section of readSections(issue.sections)) {
    if (section.heading) lines.push(section.heading, "-".repeat(Math.min(section.heading.length, 60)));
    if (section.body) lines.push(section.body);
    lines.push("");
  }

  if (issue.closing) lines.push(issue.closing.trim(), "");

  lines.push(
    "---",
    PARISH.name,
    PARISH.address,
    PARISH.phone,
    `Read this issue online: ${PARISH.site}/newsletter/issue/?slug=${encodeURIComponent(issue.slug)}`,
  );
  return lines.join("\n");
}

/**
 * The issue as HTML for email.
 *
 * Deliberately plain: a table for the outer width, inline styles, no
 * images and no web fonts. Mail clients throw away stylesheets, and a
 * parish newsletter has to be legible in Outlook, on a ten-year-old
 * phone, and in whatever the parish council uses.
 */
export function issueToHtml(issue: NewsletterIssue): string {
  const sections = readSections(issue.sections)
    .map(
      (s) =>
        `${s.heading ? `<h2 style="margin:1.75em 0 .5em;font-size:17px;line-height:1.3;color:#1f3a5f;">${escapeHtml(s.heading)}</h2>` : ""}${paragraphs(s.body)}`,
    )
    .join("");

  const label = issue.issue_label
    ? `<p style="margin:0 0 .5em;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a7a5c;">${escapeHtml(issue.issue_label)}</p>`
    : "";

  const link = `${PARISH.site}/newsletter/issue/?slug=${encodeURIComponent(issue.slug)}`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f1ea;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fffdf8;border:1px solid #e0d9c8;">
  <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #e0d9c8;">
    <p style="margin:0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8a7a5c;">
      &#9769; ${escapeHtml(PARISH.name)}
    </p>
  </td></tr>
  <tr><td style="padding:28px 32px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.65;color:#2b2b2b;">
    ${label}
    <h1 style="margin:0 0 .25em;font-size:26px;line-height:1.2;color:#1f3a5f;">${escapeHtml(issue.title)}</h1>
    ${issue.published_at ? `<p style="margin:0 0 1.5em;font-size:13px;color:#7a7a7a;">${escapeHtml(issueDate(issue.published_at))}</p>` : ""}
    ${issue.intro ? paragraphs(issue.intro) : ""}
    ${sections}
    ${issue.closing ? `<div style="margin-top:2em;padding-top:1.25em;border-top:1px solid #e0d9c8;">${paragraphs(issue.closing)}</div>` : ""}
  </td></tr>
  <tr><td style="padding:20px 32px 28px;border-top:1px solid #e0d9c8;font-family:Georgia,'Times New Roman',serif;font-size:12px;line-height:1.6;color:#7a7a7a;">
    <p style="margin:0 0 .5em;">
      <a href="${escapeHtml(link)}" style="color:#1f3a5f;">Read this issue on the website</a>
    </p>
    <p style="margin:0;">
      ${escapeHtml(PARISH.name)}<br>
      ${escapeHtml(PARISH.address)}<br>
      ${escapeHtml(PARISH.phone)}
    </p>
    <p style="margin:.75em 0 0;">
      You are receiving this because you hold an account with the parish.
      To stop receiving parish mail, reply to this message and say so.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
