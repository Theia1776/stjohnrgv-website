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

  // Site palette (src/styles/global.css, "Coastal Light"): cream page,
  // white card, slate text, Mediterranean blue button, sandstone kicker,
  // gold rule. Cinzel for headings and Crimson Pro for body where the
  // mail app has them; Times and Georgia stand in where it doesn't.
  const HEAD = "font-family:Cinzel,'Times New Roman',Times,serif";
  const BODY = "font-family:'Crimson Pro',Georgia,'Times New Roman',serif";
  const html =
    `<div style="background:#FAF7F0;padding:28px 12px">` +
    `<div style="${BODY};color:#2C3E50;line-height:1.65;font-size:19px;max-width:540px;` +
    `margin:0 auto;background:#FFFFFF;border:1px solid #E5DFD3;border-top:4px solid #C9A84C;padding:34px 30px">` +
    `<p style="${HEAD};margin:0;font-size:20px;font-weight:600;letter-spacing:1px;color:#2C3E50">ST. JOHN OF KRONSTADT</p>` +
    `<p style="${HEAD};margin:2px 0 0;font-size:12px;letter-spacing:3px;color:#A88758">ORTHODOX MISSION</p>` +
    `<div style="height:1px;width:96px;background:#C9A84C;margin:18px 0 24px"></div>` +
    `<p style="${HEAD};margin:0 0 18px;font-size:26px;font-weight:600;color:#2C3E50">Your account is ready</p>` +
    `<p style="margin:0 0 16px">Dear ${escapeHtml(name)},</p>` +
    `<p style="margin:0 0 16px">We have set up an account for you on the parish ` +
    `website. It is all ready. The only thing left is for you to choose a password.</p>` +
    `<p style="margin:0 0 28px">Press the button, type a password you will remember, ` +
    `and you will land right in your account. There is nothing else to fill out.</p>` +
    `<p style="margin:0 0 30px;text-align:center">` +
    `<a href="${link}" style="${HEAD};display:inline-block;background:#3B7BA8;color:#FFFFFF;` +
    `text-decoration:none;font-size:19px;font-weight:700;letter-spacing:.5px;padding:17px 34px;` +
    `border:1px solid #3B7BA8">Choose my password</a></p>` +
    `<p style="margin:0 0 16px;font-size:16px;color:#5C6B7A">The button works for ${days} days. ` +
    `If it stops working, or anything looks wrong, just reply to this email or call ` +
    `the parish office and we will sort it out with you.</p>` +
    `<p style="margin:0 0 26px;font-size:16px;color:#5C6B7A">If the button does not ` +
    `work, copy this address into your browser:<br>` +
    `<span style="word-break:break-all;color:#2A5E84">${escapeHtml(link)}</span></p>` +
    `<div style="height:1px;background:#E5DFD3;margin:0 0 18px"></div>` +
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
