/**
 * Shared browser-side bits for the three board pages, so the list, a
 * category and a thread all escape text the same way, say times the
 * same way, and handle a lapsed session the same way.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text to paragraphs. Escaped first, always. */
function paragraphs(text: string): string {
  const trimmed = text.replace(/^\n+|\n+$/g, "");
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/**
 * What somebody wrote, ready to drop into the page.
 *
 * Escaped first and always — no markdown, no HTML. If a person types
 * <b> they see <b>. The one piece of markup understood is the forum
 * quote, written the way boards have always written it:
 *
 *   [quote=Maria G.]what she said[/quote]
 *   and here's my answer
 *
 * which the Quote button fills in for you. Because the escaping
 * happens before this runs, nobody can smuggle HTML through the quote
 * tag — by the time we look for it, any angle brackets are already
 * harmless text.
 */
export function renderBody(text: string): string {
  const escaped = escapeHtml(text);
  const quote = /\[quote(?:=([^\]]*))?\]([\s\S]*?)\[\/quote\]/;

  let out = "";
  let rest = escaped;
  let match = rest.match(quote);

  while (match && match.index !== undefined) {
    out += paragraphs(rest.slice(0, match.index));
    const who = (match[1] ?? "").trim();
    out +=
      '<blockquote class="bb-quote">' +
      (who ? `<span class="bb-quote-who">${who} wrote:</span>` : "") +
      paragraphs(match[2]) +
      "</blockquote>";
    rest = rest.slice(match.index + match[0].length);
    match = rest.match(quote);
  }

  return out + paragraphs(rest);
}

/** The [quote=…] block the Quote button drops into the reply box. */
export function quoteOf(author: string, body: string): string {
  // Strip any quotes already inside it, so quoting a quote of a quote
  // doesn't nest five deep the way old boards used to let it.
  const inner = body.replace(/\[quote(?:=[^\]]*)?\][\s\S]*?\[\/quote\]/g, "").trim();
  return `[quote=${author}]${inner}[/quote]\n\n`;
}

/** "just now", "20 minutes ago", "Tuesday", "12 Nov 2026". */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  // Inside the last week, the day name is easier to place than a date.
  const days = Math.round(hours / 24);
  if (days < 7) {
    return then.toLocaleDateString("en-US", { weekday: "long" });
  }

  const sameYear = then.getFullYear() === new Date().getFullYear();
  return then.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The exact moment, for a title attribute. */
export function exactly(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * The smilies panel, the way boards used to put one beside the post
 * box. Click one and it drops in wherever the cursor is.
 *
 * A fixed set rather than the system picker: it's one click instead of
 * a keyboard shortcut nobody remembers, it looks the same on every
 * machine, and it keeps the box to things that suit a parish board.
 * Anyone who wants the full set can still use their own keyboard's
 * picker — this doesn't block that.
 */
const SMILIES: Array<[string, string[]]> = [
  ["Faces", ["🙂", "😀", "😄", "😅", "😂", "🥹", "😉", "😊", "🥰", "😍", "🤗", "🤔", "😬", "😴", "😢", "😭", "😳", "🙃", "😇", "🫶"]],
  ["Hands", ["🙏", "👍", "👋", "👏", "🤝", "💪", "✌️", "🤞"]],
  ["Church", ["☦️", "✝️", "🕯️", "⛪", "📖", "🛐", "😇", "🕊️", "📿", "🪔"]],
  ["Table", ["🍞", "🍲", "🥘", "🫓", "🥗", "🍇", "🍎", "🐟", "🍯", "☕", "🫖", "🍋"]],
  ["Other", ["❤️", "🔥", "✨", "⭐", "🎉", "📌", "✅", "❓", "❗", "💡"]],
];

/**
 * Hang a smilies panel off a text box. `mount` is where the button
 * goes; the tray opens under it and inserts at the cursor.
 */
export function attachSmilies(field: HTMLTextAreaElement | HTMLInputElement, mount: HTMLElement): void {
  if (mount.dataset.smilies === "1") return;
  mount.dataset.smilies = "1";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bb-btn";
  button.textContent = "Smilies";
  button.setAttribute("aria-expanded", "false");

  const tray = document.createElement("div");
  tray.className = "bb-smilies hidden";
  tray.innerHTML = SMILIES.map(
    ([group, list]) =>
      `<div class="bb-smilie-group"><span class="bb-smilie-label">${group}</span>` +
      list
        .map(
          (e) =>
            `<button type="button" class="bb-smilie" data-emoji="${e}" title="${e}" aria-label="Insert ${e}">${e}</button>`,
        )
        .join("") +
      `</div>`,
  ).join("");

  button.addEventListener("click", () => {
    const nowHidden = tray.classList.toggle("hidden");
    button.setAttribute("aria-expanded", String(!nowHidden));
  });

  tray.addEventListener("click", (event) => {
    const hit = (event.target as HTMLElement).closest(".bb-smilie") as HTMLElement | null;
    if (!hit?.dataset.emoji) return;
    insertAtCursor(field, hit.dataset.emoji);
  });

  mount.appendChild(button);
  mount.appendChild(tray);
}

/** Drop text in at the cursor, keeping the cursor after it. */
export function insertAtCursor(
  field: HTMLTextAreaElement | HTMLInputElement,
  text: string,
): void {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + text + field.value.slice(end);
  const after = start + text.length;
  field.focus();
  field.setSelectionRange(after, after);
}

/** The error text an API route sent, if it sent one. */
export async function errorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : "";
  } catch {
    return "";
  }
}

/**
 * Fetch a board route. Sends the session, never caches, and bounces to
 * sign-in if the session has lapsed — the board is useless without one.
 */
export async function boardFetch(
  url: string,
  init: RequestInit = {},
  returnTo = "/board/",
): Promise<Response | null> {
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (res.status === 401) {
    window.location.assign(`/login/?next=${encodeURIComponent(returnTo)}`);
    return null;
  }
  return res;
}
