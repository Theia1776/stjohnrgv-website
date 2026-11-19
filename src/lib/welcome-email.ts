/**
 * The "your account is ready" email: one big button that opens a page
 * with a single box for choosing a password, then drops the person
 * straight into their account.
 */

export function welcomeEmail(firstName: string, link: string, days: number) {
  const name = firstName.trim() || "friend";
  const subject = "Your St. John of Kronstadt website account is ready";

  const text =
    `Dear ${name},\n\n` +
    `We have set up an account for you on the St. John of Kronstadt ` +
    `parish website. It is all ready. The only thing left is for you to ` +
    `choose a password.\n\n` +
    `Click this link, type a password you will remember, and press the ` +
    `button. You will land right in your account. There is nothing else ` +
    `to fill out.\n\n` +
    `${link}\n\n` +
    `The link works for ${days} days. If it stops working, or anything ` +
    `looks wrong, just reply to this email or call the parish office and ` +
    `we will sort it out with you.\n\n` +
    `You do not have to do anything else, and you can ignore this email ` +
    `if you would rather not.\n\n` +
    `With love in Christ,\n` +
    `St. John of Kronstadt Orthodox Mission`;

  const html =
    `<div style="background:#f6f1e7;padding:24px 12px">` +
    `<div style="font-family:Georgia,'Times New Roman',serif;color:#2b2b2b;` +
    `line-height:1.65;font-size:18px;max-width:520px;margin:0 auto;` +
    `background:#ffffff;border:1px solid #e4dccb;padding:32px 28px">` +
    `<p style="margin:0 0 6px;font-size:13px;letter-spacing:2px;` +
    `text-transform:uppercase;color:#8a6d2f">St. John of Kronstadt Orthodox Mission</p>` +
    `<p style="margin:0 0 20px;font-size:24px;color:#1a2f5e">Your account is ready</p>` +
    `<p style="margin:0 0 16px">Dear ${escapeHtml(name)},</p>` +
    `<p style="margin:0 0 16px">We have set up an account for you on the parish ` +
    `website. It is all ready. The only thing left is for you to choose a password.</p>` +
    `<p style="margin:0 0 24px">Press the button, type a password you will remember, ` +
    `and you will land right in your account. There is nothing else to fill out.</p>` +
    `<p style="margin:0 0 28px;text-align:center">` +
    `<a href="${link}" style="display:inline-block;background:#1a2f5e;color:#ffffff;` +
    `text-decoration:none;font-size:20px;font-weight:bold;padding:16px 32px;` +
    `border-radius:4px">Choose my password</a></p>` +
    `<p style="margin:0 0 16px;font-size:15px;color:#555">The button works for ${days} days. ` +
    `If it stops working, or anything looks wrong, just reply to this email or call ` +
    `the parish office and we will sort it out with you.</p>` +
    `<p style="margin:0 0 24px;font-size:15px;color:#555">If the button does not ` +
    `work, copy this address into your browser:<br>` +
    `<span style="word-break:break-all;color:#1a2f5e">${escapeHtml(link)}</span></p>` +
    `<p style="margin:0">With love in Christ,<br>St. John of Kronstadt Orthodox Mission</p>` +
    `</div></div>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
