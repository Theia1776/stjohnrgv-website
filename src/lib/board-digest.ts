/**
 * Board digests: who is due, and what the email says.
 *
 * Daily goes out at 7:00 p.m. and weekly on Sunday at 7:00 p.m., both
 * on the parish's clock (US Central), when people are done with the day. A scheduled job asks every 15
 * minutes who is due; someone is due when their last digest is older
 * than the most recent scheduled moment.
 */

const ZONE = "America/Chicago";

function offsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const m = name.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return -360;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

/** The parish's wall clock for a moment: year, month, day, hour, weekday (0 = Sunday). */
function wall(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24,
    dow,
  };
}

/** The real moment that a wall-clock time falls on in the parish's zone. */
function atParish(y: number, mo: number, d: number, h: number): Date {
  let guess = new Date(Date.UTC(y, mo - 1, d, h));
  guess = new Date(guess.getTime() - offsetMinutes(guess) * 60000);
  guess = new Date(Date.UTC(y, mo - 1, d, h) - offsetMinutes(guess) * 60000);
  return guess;
}

/** The most recent moment this frequency was meant to go out, at or before `now`. */
export function lastScheduled(frequency: "daily" | "weekly", now: Date): Date {
  const w = wall(now);
  if (frequency === "daily") {
    const today = atParish(w.y, w.mo, w.d, 19);
    return today <= now ? today : atParish(w.y, w.mo, w.d - 1, 19);
  }
  const sunday = atParish(w.y, w.mo, w.d - w.dow, 19);
  return sunday <= now ? sunday : atParish(w.y, w.mo, w.d - w.dow - 7, 19);
}

export function isDue(frequency: string, lastSentAt: string, now: Date): boolean {
  if (frequency !== "daily" && frequency !== "weekly") return false;
  return new Date(lastSentAt).getTime() < lastScheduled(frequency, now).getTime();
}

export interface DigestTopic {
  title: string;
  roomName: string;
  roomSlug: string;
  newPosts: number;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function digestEmail(opts: {
  firstName: string;
  frequency: "daily" | "weekly";
  topics: DigestTopic[];
  moreTopics: number;
  messages: number;
  mentions: number;
  origin: string;
}) {
  const { origin } = opts;
  const name = opts.firstName.trim() || "friend";
  const subject = opts.frequency === "weekly" ? "This week on the parish board" : "What's new on the parish board";

  const lead: string[] = [];
  if (opts.messages) lead.push(`You have ${plural(opts.messages, "unread private message")}.`);
  if (opts.mentions) lead.push(`${plural(opts.mentions, "person", "people")} mentioned you.`.replace(/^1 person mentioned/, "Someone mentioned").replace(/^(\d+) people mentioned/, "$1 people mentioned"));

  // --- plain text
  const t: string[] = [`Greetings, ${name}!`, ""];
  if (lead.length) t.push(...lead, `Read your messages: ${origin}/board/messages/`, "");
  if (opts.topics.length) {
    t.push(opts.frequency === "weekly" ? "New this week, busiest first:" : "New since the last email, busiest first:");
    for (const x of opts.topics) {
      t.push(`- ${x.title} (${plural(x.newPosts, "new post")}) in ${x.roomName}: ${origin}/board/category/?c=${x.roomSlug}`);
    }
    if (opts.moreTopics) t.push(`...and ${plural(opts.moreTopics, "more topic")}.`);
    t.push("", "On the board, anything you haven't read yet is in bold, and it goes back to normal once you've read it.");
  }
  if (!opts.topics.length) {
    t.push(opts.frequency === "weekly" ? "Nobody posted on the board this week." : "Nobody posted on the board today.", "Would you like to start a conversation?");
  }
  t.push("", `${opts.topics.length ? "Open the board" : "Start a conversation"}: ${origin}/board/`, "", `You asked for this email. To change how often it comes, or stop it: ${origin}/account/#section-board`, "", "With love in Christ,", "St. John of Kronstadt Orthodox Mission");
  const text = t.join("\n");

  // --- html, in the site's colors
  const HEAD = "font-family:Cinzel,'Times New Roman',Times,serif";
  const BODY = "font-family:'Crimson Pro',Georgia,'Times New Roman',serif";
  const rows = opts.topics
    .map(
      (x) =>
        `<tr><td style="padding:10px 0;border-top:1px solid #E5DFD3">` +
        `<span style="font-weight:700;font-size:18px">${esc(x.title)}</span><br>` +
        `<span style="font-size:15px;color:#5C6B7A">${esc(plural(x.newPosts, "new post"))} in ` +
        `<a href="${origin}/board/category/?c=${encodeURIComponent(x.roomSlug)}" style="color:#2A5E84">${esc(x.roomName)}</a></span></td></tr>`,
    )
    .join("");
  const leadHtml = lead.length
    ? `<div style="background:#FAF7F0;border-left:4px solid #C9A84C;padding:12px 16px;margin:0 0 22px">` +
      lead.map((l) => `<p style="margin:0 0 4px;font-weight:700">${esc(l)}</p>`).join("") +
      `<p style="margin:6px 0 0"><a href="${origin}/board/messages/" style="color:#2A5E84">Read your messages</a></p></div>`
    : "";
  const html =
    `<div style="background:#FAF7F0;padding:28px 12px"><div style="${BODY};color:#2C3E50;line-height:1.6;font-size:18px;max-width:540px;margin:0 auto;background:#FFFFFF;border:1px solid #E5DFD3;border-top:4px solid #C9A84C">` +
    `<div style="background:#1A2B42;padding:26px 30px"><p style="${HEAD};margin:0;font-size:22px;font-weight:700;letter-spacing:1px;color:#FFFFFF">ST. JOHN OF KRONSTADT</p>` +
    `<p style="${HEAD};margin:4px 0 0;font-size:13px;letter-spacing:3px;color:#C9B99A">ORTHODOX MISSION</p></div>` +
    `<div style="padding:28px 30px 32px">` +
    `<p style="${HEAD};margin:0 0 16px;font-size:24px;font-weight:600">${esc(subject)}</p>` +
    `<p style="margin:0 0 18px">Greetings, ${esc(name)}!</p>` +
    leadHtml +
    (opts.topics.length
      ? `<p style="margin:0 0 4px;font-weight:700">${opts.frequency === "weekly" ? "New this week, busiest first" : "New since the last email, busiest first"}</p>` +
        `<table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>` +
        (opts.moreTopics ? `<p style="margin:10px 0 0;color:#5C6B7A;font-size:15px">...and ${esc(plural(opts.moreTopics, "more topic"))}.</p>` : "") +
        `<p style="margin:18px 0 0;color:#5C6B7A;font-size:15px">On the board, anything you haven't read yet is in bold, and it goes back to normal once you've read it.</p>`
      : `<p style="margin:0 0 4px;font-size:19px">${opts.frequency === "weekly" ? "Nobody posted on the board this week." : "Nobody posted on the board today."}</p>` +
        `<p style="margin:0;font-size:19px;font-weight:700">Would you like to start a conversation?</p>`) +
    `<p style="margin:26px 0;text-align:center"><a href="${origin}/board/" style="${HEAD};display:inline-block;background:#1A2B42;color:#FFFFFF;text-decoration:none;font-size:18px;font-weight:700;padding:15px 32px;border:1px solid #C9A84C">${opts.topics.length ? "Open the board" : "Start a conversation"}</a></p>` +
    `<p style="margin:0 0 6px;font-size:14px;color:#5C6B7A">You asked for this email. <a href="${origin}/account/#section-board" style="color:#2A5E84">Change how often it comes, or stop it.</a></p>` +
    `<p style="margin:14px 0 0">With love in Christ,<br>St. John of Kronstadt Orthodox Mission</p>` +
    `</div></div></div>`;

  return { subject, text, html };
}
