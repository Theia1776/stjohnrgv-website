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

/* ---------------------------------------------------------------
   Formatting
   ---------------------------------------------------------------
   Written the way boards always wrote it, in square brackets:

     [b]bold[/b]  [i]italic[/i]  [u]underlined[/u]
     [size=large]bigger[/size]  [color=red]red[/color]
     [url=https://example.org]a linked word[/url]

   The toolbar above the post box types these for you, so nobody has
   to know them. Sizes and colours come from a fixed list, and each is
   a CSS class -- never a value somebody typed -- so there is no way to
   put anything but a size or a colour on the page, and the colours
   have a lighter twin for the dark theme (see board.css).
   --------------------------------------------------------------- */

/** Name, label, in the order the picker shows them. */
export const COLORS: Array<[string, string]> = [
  ["navy", "Navy"],
  ["red", "Red"],
  ["orange", "Orange"],
  ["gold", "Gold"],
  ["green", "Green"],
  ["blue", "Blue"],
  ["purple", "Purple"],
  ["gray", "Gray"],
];
const SIZES: Array<[string, string]> = [
  ["tiny", "Tiny"],
  ["small", "Small"],
  ["large", "Large"],
  ["huge", "Huge"],
];
const COLOR_NAMES = new Set(COLORS.map(([name]) => name));
const SIZE_NAMES = new Set(SIZES.map(([name]) => name));

type FormatTag = { close: boolean; name: string; value: string };

const FORMAT_TAG = /\[(\/?)(b|i|u|size|color|url)(?:=([^\]\s]*))?\]/gi;
// Private-use characters stand in for a tag between pairing and
// output. Anything a person types in that range is dropped first.
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";

/**
 * Where a link may go. Runs on text that has already been escaped, so
 * a quote or angle bracket in it is already &quot; or &lt; and is
 * refused here: an address can never close its own attribute. Only
 * http, https, or a page on this site (starting with a single slash).
 */
function safeHref(escaped: string): boolean {
  if (/&(?:quot|lt|gt|#39);|[\s\uE000\uE001]/.test(escaped)) return false;
  return /^https?:\/\/[^/]/i.test(escaped) || /^\/(?![/\\])/.test(escaped);
}

function validTag(name: string, value: string, close: boolean): boolean {
  if (close) return value === "";
  if (name === "size") return SIZE_NAMES.has(value);
  if (name === "color") return COLOR_NAMES.has(value);
  if (name === "url") return safeHref(value);
  return value === "";
}

function openHtml(tag: FormatTag): string {
  switch (tag.name) {
    case "b":
      return "<strong>";
    case "i":
      return "<em>";
    case "u":
      return "<u>";
    case "size":
      return `<span class="bb-s-${tag.value}">`;
    case "url": {
      // A page on this site opens where you are; anywhere else opens
      // in a new tab and isn't counted by search engines.
      const own = tag.value.startsWith("/") || /^https?:\/\/(?:www\.)?stjohnrgv\.org(?:[/?#]|$)/i.test(tag.value);
      return own
        ? `<a href="${tag.value}">`
        : `<a href="${tag.value}" target="_blank" rel="noopener noreferrer nofollow">`;
    }
    default:
      return `<span class="bb-c-${tag.value}">`;
  }
}

function closeHtml(name: string): string {
  return name === "b" ? "</strong>" : name === "i" ? "</em>" : name === "u" ? "</u>" : name === "url" ? "</a>" : "</span>";
}

/**
 * Pair up the tags. One that never gets closed, or is closed out of
 * order, or has a size or colour that isn't on the list, is left alone
 * and shows as the plain text it was typed as -- which is what a board
 * does with a tag it can't make sense of, and tells the writer what
 * went wrong.
 */
function markFormatting(text: string): { marked: string; toks: FormatTag[] } {
  const clean = text.replace(/[\uE000\uE001]/g, "");

  const found: Array<{ start: number; end: number; tag: FormatTag; paired: boolean }> = [];
  for (const m of clean.matchAll(FORMAT_TAG)) {
    const close = m[1] === "/";
    const name = m[2].toLowerCase();
    // An address keeps its capitals; a size or colour name doesn't need them.
    const value = name === "url" ? (m[3] ?? "") : (m[3] ?? "").toLowerCase();
    if (!validTag(name, value, close)) continue;
    const start = m.index ?? 0;
    found.push({ start, end: start + m[0].length, tag: { close, name, value }, paired: false });
  }

  const stack: number[] = [];
  found.forEach((t, i) => {
    if (!t.tag.close) {
      stack.push(i);
      return;
    }
    for (let s = stack.length - 1; s >= 0; s--) {
      if (found[stack[s]].tag.name === t.tag.name) {
        found[stack[s]].paired = true;
        t.paired = true;
        stack.length = s; // anything opened inside and never closed is dropped
        return;
      }
    }
  });

  const toks: FormatTag[] = [];
  let marked = "";
  let at = 0;
  for (const t of found) {
    if (!t.paired) continue;
    marked += clean.slice(at, t.start) + MARK_OPEN + toks.length + MARK_CLOSE;
    toks.push(t.tag);
    at = t.end;
  }
  return { marked: marked + clean.slice(at), toks };
}

/**
 * Turn web addresses in already-escaped text into links. Only http and
 * https, opens in a new tab, and tells search engines not to count it.
 */
function linkify(escaped: string): string {
  return escaped.replace(
    /https?:\/\/(?:(?!&lt;|&gt;|&quot;)[^\s\uE000\uE001])+/g,
    (raw) => {
      let url = raw;
      let tail = "";
      // A full stop or bracket at the end of a sentence isn't part of the address.
      for (;;) {
        const before = url;
        url = url.replace(/(?:&#39;|[.,;:!?])$/, (t) => {
          tail = t + tail;
          return "";
        });
        const opens = (url.match(/\(/g) ?? []).length;
        const closes = (url.match(/\)/g) ?? []).length;
        if (url.endsWith(")") && closes > opens) {
          url = url.slice(0, -1);
          tail = ")" + tail;
        }
        if (url === before) break;
      }
      if (!/^https?:\/\/[^/]/.test(url)) return raw;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>${tail}`;
    },
  );
}

/** Plain text to paragraphs. Escaped first, always. */
function paragraphs(text: string): string {
  const trimmed = text.replace(/^\n+|\n+$/g, "");
  if (!trimmed) return "";

  const { marked, toks } = markFormatting(trimmed);
  const tagOrBreak = new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}|\\n`, "g");

  // A bold or coloured stretch can run across a blank line. Each
  // paragraph is its own <p>, so whatever is still open is closed at
  // the end of one and opened again at the start of the next.
  const open: FormatTag[] = [];
  return linkify(marked)
    .split(/\n{2,}/)
    .map((para) => {
      let html = open.map(openHtml).join("");
      html += para.replace(tagOrBreak, (_m, n?: string) => {
        if (n === undefined) return "<br />";
        const tag = toks[Number(n)];
        if (tag.close) {
          open.pop();
          return closeHtml(tag.name);
        }
        open.push(tag);
        return openHtml(tag);
      });
      html += [...open].reverse().map((t) => closeHtml(t.name)).join("");
      return `<p>${html}</p>`;
    })
    .join("");
}

/* ---------------------------------------------------------------
   Video links
   ---------------------------------------------------------------
   Nobody uploads video here -- it is enormous, and the people who
   have it already put it on YouTube. A YouTube or Vimeo link in a
   post gets a player under the post, and the link itself stays
   clickable. Only those two sites, recognised by address; nothing
   else a person pastes is ever put in a frame.
   --------------------------------------------------------------- */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function embedSource(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/[.,;:!?)]+$/, ""));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "youtube.com") {
    let id = "";
    if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      if (m) id = m[1];
    }
    return YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "vimeo.com") {
    const m = url.pathname.match(/^\/(\d{6,12})\/?$/);
    return m ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  return null;
}

/** Players for any YouTube or Vimeo links in a post's own words (not in a quote). */
export function videoEmbeds(text: string): string {
  const own = text.replace(/\[quote(?:=[^\]]*)?\][\s\S]*?\[\/quote\]/g, "");
  const seen = new Set<string>();
  const out: string[] = [];

  for (const m of own.matchAll(/https?:\/\/[^\s<>"'\[\]]+/g)) {
    const src = embedSource(m[0]);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(
      `<div class="bb-video"><iframe src="${src}" title="Video" loading="lazy" allowfullscreen ` +
        `referrerpolicy="strict-origin-when-cross-origin" ` +
        `allow="encrypted-media; picture-in-picture; fullscreen"></iframe></div>`,
    );
    if (out.length >= 3) break;
  }
  return out.join("");
}

/* ---------------------------------------------------------------
   The toolbar above a post box
   --------------------------------------------------------------- */

/** Wrap whatever is selected, or drop the pair in with the cursor between. */
function wrapSelection(field: HTMLTextAreaElement, open: string, close: string): void {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const chosen = field.value.slice(start, end);
  field.value = field.value.slice(0, start) + open + chosen + close + field.value.slice(end);
  field.focus();
  if (chosen) field.setSelectionRange(start + open.length, start + open.length + chosen.length);
  else field.setSelectionRange(start + open.length, start + open.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * "Link": ask for the words and where they go, then put
 * [url=address]words[/url] into the box. Whatever was selected in the
 * box becomes the words, so the usual way is to type the words, select
 * them, press Link, and paste the address.
 */
async function addLink(field: HTMLTextAreaElement): Promise<void> {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const chosen = field.value.slice(start, end);

  const dialog = document.createElement("dialog");
  dialog.className = "bb-help-dialog";
  dialog.innerHTML = `
    <h2>Add a link</h2>
    <label class="bb-help-label" for="link-words">The words people will see</label>
    <input id="link-words" type="text" maxlength="200" autocomplete="off" />
    <label class="bb-help-label" for="link-address" style="margin-top:0.8rem">Where it goes (paste the web address)</label>
    <input id="link-address" type="text" inputmode="url" maxlength="1000" autocomplete="off" autocapitalize="off" spellcheck="false" />
    <p class="bb-help-lead" id="link-error" role="alert" hidden style="margin:0.6rem 0 0;color:var(--color-liturgical-red)"></p>
    <div class="bb-help-actions">
      <button type="button" id="link-add" class="bb-btn bb-btn-strong">Add link</button>
      <button type="button" id="link-cancel" class="bb-btn">Cancel</button>
    </div>`;
  document.body.appendChild(dialog);

  const words = dialog.querySelector("#link-words") as HTMLInputElement;
  const address = dialog.querySelector("#link-address") as HTMLInputElement;
  const error = dialog.querySelector("#link-error") as HTMLElement;
  words.value = chosen;

  const close = () => {
    dialog.close();
    dialog.remove();
    field.focus();
  };

  const add = () => {
    const text = words.value.trim().replace(/[\[\]]/g, "");
    let url = address.value.trim();
    // "stjohnrgv.org/table/" with no https:// in front is what people paste.
    if (url && !/^(?:https?:\/\/|\/)/i.test(url) && /^[^\s/]+\.[^\s/]+/.test(url)) url = "https://" + url;
    if (!text) {
      error.textContent = "Type the words you want people to click on.";
      error.hidden = false;
      words.focus();
      return;
    }
    if (!/^https?:\/\/[^/\s\[\]"<>]/i.test(url) && !/^\/(?![/\\])[^\s\[\]"<>]*$/.test(url)) {
      error.textContent = "That doesn't look like a web address. It usually starts with https://";
      error.hidden = false;
      address.focus();
      return;
    }
    if (/[\s\[\]"<>]/.test(url)) {
      error.textContent = "That address has a space or a symbol that won't work in a link.";
      error.hidden = false;
      address.focus();
      return;
    }
    const tag = `[url=${url}]${text}[/url]`;
    field.value = field.value.slice(0, start) + tag + field.value.slice(end);
    const at = start + tag.length;
    close();
    field.setSelectionRange(at, at);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  dialog.querySelector("#link-add")?.addEventListener("click", add);
  dialog.querySelector("#link-cancel")?.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  });
  dialog.showModal();
  (chosen ? address : words).focus();
}

/**
 * Bold, italic, underline, size and colour -- plus a Preview, because
 * the box holds the little bracket tags and people want to see the
 * result before they post it. Sits above the box (above its label, if
 * it has one). Ctrl/Cmd+B, I and U work inside the box too.
 */
export function attachFormatBar(field: HTMLTextAreaElement): void {
  if (field.dataset.formatBar === "1") return;
  field.dataset.formatBar = "1";
  attachMentions(field);
  attachDraft(field);

  const bar = document.createElement("div");
  bar.className = "bb-format";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Text formatting");
  bar.innerHTML =
    `<button type="button" class="bb-btn bb-fmt" data-tag="b" title="Bold (Ctrl+B)" aria-label="Bold"><strong>B</strong></button>` +
    `<button type="button" class="bb-btn bb-fmt" data-tag="i" title="Italic (Ctrl+I)" aria-label="Italic"><em>I</em></button>` +
    `<button type="button" class="bb-btn bb-fmt" data-tag="u" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>` +
    `<select class="bb-fmt-size" aria-label="Text size">` +
    `<option value="">Size</option>` +
    SIZES.map(([v, label]) => `<option value="${v}">${label}</option>`).join("") +
    `</select>` +
    `<span class="bb-fmt-color">` +
    `<button type="button" class="bb-btn bb-fmt-colorbtn" aria-expanded="false">Color</button>` +
    `<span class="bb-swatches hidden">` +
    COLORS.map(
      ([v, label]) =>
        `<button type="button" class="bb-swatch bb-sw-${v}" data-color="${v}" title="${label}" aria-label="${label}"></button>`,
    ).join("") +
    `</span></span>` +
    `<button type="button" class="bb-btn bb-fmt-link" title="Turn words into a link" aria-label="Add a link">Link</button>` +
    `<button type="button" class="bb-btn bb-fmt-preview" aria-pressed="false">Preview</button>`;

  const anchor = field.closest("label") ?? field;
  anchor.insertAdjacentElement("beforebegin", bar);

  const preview = document.createElement("div");
  preview.className = "bb-preview bb-body hidden";
  preview.setAttribute("aria-live", "polite");
  field.insertAdjacentElement("afterend", preview);

  const swatches = bar.querySelector(".bb-swatches") as HTMLElement;
  const colorButton = bar.querySelector(".bb-fmt-colorbtn") as HTMLElement;
  const previewButton = bar.querySelector(".bb-fmt-preview") as HTMLElement;
  const sizeSelect = bar.querySelector(".bb-fmt-size") as HTMLSelectElement;

  const refresh = () => {
    preview.innerHTML =
      renderBody(field.value) + videoEmbeds(field.value) ||
      '<p class="bb-preview-empty">Nothing to preview yet.</p>';
  };

  bar.addEventListener("click", (event) => {
    const hit = event.target as HTMLElement;

    const tagButton = hit.closest(".bb-fmt") as HTMLElement | null;
    if (tagButton?.dataset.tag) {
      const t = tagButton.dataset.tag;
      wrapSelection(field, `[${t}]`, `[/${t}]`);
      return;
    }

    const swatch = hit.closest(".bb-swatch") as HTMLElement | null;
    if (swatch?.dataset.color) {
      wrapSelection(field, `[color=${swatch.dataset.color}]`, "[/color]");
      swatches.classList.add("hidden");
      colorButton.setAttribute("aria-expanded", "false");
      return;
    }

    if (hit.closest(".bb-fmt-colorbtn")) {
      const nowHidden = swatches.classList.toggle("hidden");
      colorButton.setAttribute("aria-expanded", String(!nowHidden));
      return;
    }

    if (hit.closest(".bb-fmt-link")) {
      void addLink(field);
      return;
    }

    if (hit.closest(".bb-fmt-preview")) {
      const nowHidden = preview.classList.toggle("hidden");
      previewButton.setAttribute("aria-pressed", String(!nowHidden));
      previewButton.textContent = nowHidden ? "Preview" : "Hide preview";
      if (!nowHidden) refresh();
    }
  });

  sizeSelect.addEventListener("change", () => {
    if (sizeSelect.value) wrapSelection(field, `[size=${sizeSelect.value}]`, "[/size]");
    sizeSelect.value = "";
  });

  field.addEventListener("input", () => {
    if (!preview.classList.contains("hidden")) refresh();
  });

  field.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "b" || key === "i" || key === "u") {
      event.preventDefault();
      wrapSelection(field, `[${key}]`, `[/${key}]`);
    }
  });
}

/**
 * What somebody wrote, ready to drop into the page.
 *
 * Escaped first and always — no markdown, no HTML. If a person types
 * <b> they see <b>. The only markup understood is the board's own
 * square-bracket kind: [b] [i] [u] [size=] [color=] (see above), web
 * addresses becoming links, and the forum quote, written the way
 * boards have always written it:
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

  return highlightMentions(out + paragraphs(rest));
}

/**
 * A signature: escaped, line breaks kept, nothing else understood. No
 * quote tags, no markup, so it can't be used to dress up as somebody
 * else's words.
 */
export function renderSignature(text: string): string {
  const trimmed = (text ?? "").trim();
  return trimmed ? escapeHtml(trimmed).replace(/\n/g, "<br />") : "";
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
  if (res.status === 403) {
    const detail = await res
      .clone()
      .json()
      .catch(() => null);
    if (detail?.terms) {
      showTermsDialog(String(detail.version ?? ""));
      return null;
    }
  }
  return res;
}

/**
 * The welcome window: shown the first time someone opens the board, and
 * again whenever the terms change. The server won't answer anything
 * else until they agree, so closing it just leaves them outside.
 */
function showTermsDialog(version: string): void {
  if (document.getElementById("terms-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "terms-dialog";
  dialog.className = "bb-help-dialog";
  dialog.innerHTML = `
    <h2>Welcome to the parish board</h2>
    <p class="bb-help-lead">Before you come in, please read how we use the board together. You agree at the end of the Terms.</p>
    <ul class="bb-terms-list">
      <li>Christian conduct: be considerate, honest and kind. No harassment, threats, hate, or explicit material.</li>
      <li>You are responsible for what you post, and a message can't be taken back once it's sent.</li>
      <li>Private messages are private between the people in them, but they are not encrypted. A reported conversation is read by the admins.</li>
      <li>Moderators and admins can remove posts and access.</li>
      <li>Members under 18 are welcome with a parent's or guardian's permission.</li>
    </ul>
    <div class="bb-help-actions">
      <a id="terms-read" class="bb-btn bb-btn-strong" href="/board/terms/?next=${encodeURIComponent(window.location.pathname + window.location.search)}">Read the Terms and agree</a>
      <button type="button" id="terms-leave" class="bb-btn">Not now</button>
    </div>`;
  document.body.appendChild(dialog);

  const leave = () => window.location.assign("/");
  dialog.querySelector("#terms-leave")?.addEventListener("click", leave);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    leave();
  });
  void version;
  dialog.showModal();
}


/* ---------------------------------------------------------------
   @mentions
   ---------------------------------------------------------------
   Type @ and the start of a name and a short list of people appears;
   pick one and "@Maria G. " goes into the box. When a post is shown,
   any "@Name" that matches someone on the board is highlighted. The
   text stays plain so it reads fine while it's being typed.
   --------------------------------------------------------------- */
let mentionRegex: RegExp | null = null;

/** Tell the page whom to highlight. Names as the board shows them. */
export function setMentionNames(names: string[]): void {
  const alternatives = names
    .filter(Boolean)
    .map((n) => escapeHtml(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  mentionRegex = alternatives.length
    ? new RegExp(`(^|[\\s>(])@(${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu")
    : null;
}

function highlightMentions(html: string): string {
  return mentionRegex ? html.replace(mentionRegex, '$1<span class="bb-mention">@$2</span>') : html;
}

let mentionPeopleCache: string[] | null = null;

async function mentionPeople(): Promise<string[]> {
  if (mentionPeopleCache) return mentionPeopleCache;
  try {
    const res = await fetch("/api/board/people", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const names: string[] = (data.people ?? []).map((p: { name: string }) => p.name);
    mentionPeopleCache = names;
    setMentionNames([...names, ...(data.me?.name ? [data.me.name as string] : [])]);
    return names;
  } catch {
    return [];
  }
}

/** Hang the @ list off a text box. */
export function attachMentions(field: HTMLTextAreaElement): void {
  if (field.dataset.mentions === "1") return;
  field.dataset.mentions = "1";

  const list = document.createElement("div");
  list.className = "bb-mention-list hidden";
  list.setAttribute("role", "listbox");
  field.insertAdjacentElement("afterend", list);

  let items: string[] = [];
  let active = 0;
  const tail = /(^|\s)@([^\n@]{0,30})$/u;

  const close = () => {
    items = [];
    list.classList.add("hidden");
  };
  const draw = () => {
    list.innerHTML = items
      .map(
        (n, i) =>
          `<button type="button" class="bb-mention-item${i === active ? " active" : ""}" data-i="${i}">@${escapeHtml(n)}</button>`,
      )
      .join("");
    list.classList.toggle("hidden", items.length === 0);
  };
  const pick = (i: number) => {
    const name = items[i];
    const pos = field.selectionStart ?? field.value.length;
    const m = field.value.slice(0, pos).match(tail);
    if (!name || !m) return close();
    const start = pos - m[2].length - 1;
    field.value = field.value.slice(0, start) + "@" + name + " " + field.value.slice(pos);
    const after = start + name.length + 2;
    field.focus();
    field.setSelectionRange(after, after);
    close();
  };

  field.addEventListener("input", async () => {
    const pos = field.selectionStart ?? field.value.length;
    const m = field.value.slice(0, pos).match(tail);
    if (!m) return close();
    const q = m[2].toLowerCase();
    const names = await mentionPeople();
    items = names
      .filter((n) => {
        const low = n.toLowerCase();
        return !q || low.startsWith(q) || low.split(" ").some((w) => w.startsWith(q));
      })
      .slice(0, 6);
    active = 0;
    draw();
  });
  field.addEventListener("keydown", (event) => {
    if (list.classList.contains("hidden") || !items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = (active + 1) % items.length;
      draw();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = (active - 1 + items.length) % items.length;
      draw();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape") {
      close();
    }
  });
  list.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const hit = (event.target as HTMLElement).closest(".bb-mention-item") as HTMLElement | null;
    if (hit?.dataset.i) pick(Number(hit.dataset.i));
  });
  field.addEventListener("blur", () => setTimeout(close, 150));
}


/* ---------------------------------------------------------------
   The navigation strip
   ---------------------------------------------------------------
   Every board page except the front page (which has its own panel) and
   the terms gets a row of links across the top: the board, Messages,
   Mentions, New posts, Search. The counts beside Messages and Mentions
   come from one small request. It adds itself when this file loads, so
   no page has to remember to ask for it.
   --------------------------------------------------------------- */
function mountBoardNav(): void {
  const path = window.location.pathname;
  if (!path.startsWith("/board/")) return;
  if (path === "/board/" || path.startsWith("/board/terms")) return;
  if (document.getElementById("bb-nav")) return;

  const main = document.querySelector("main");
  if (!main) return;

  const nav = document.createElement("nav");
  nav.id = "bb-nav";
  nav.className = "bb-nav";
  nav.setAttribute("aria-label", "Parish board");
  const here = (href: string) => (path === href ? ' aria-current="page"' : "");
  nav.innerHTML =
    `<a class="bb-btn" href="/board/"${here("/board/")}>Parish Board</a>` +
    `<a class="bb-btn" href="/board/messages/" id="bb-nav-messages"${here("/board/messages/")}>Messages</a>` +
    `<a class="bb-btn" href="/board/mentions/" id="bb-nav-mentions"${here("/board/mentions/")}>Mentions</a>` +
    `<a class="bb-btn" href="/board/new/"${here("/board/new/")}>New posts</a>` +
    `<a class="bb-btn" href="/board/search/"${here("/board/search/")}>Search</a>` +
    `<a class="bb-btn" href="/board/profile/?id=me"${here("/board/profile/")}>My profile</a>` +
    `<a class="bb-btn" href="/directory/">Directory</a>` +
    `<a class="bb-btn" href="#" id="text-size-link">Larger text</a>`;

  const crumb = main.querySelector(".bb-crumb");
  if (crumb && crumb.parentNode) crumb.parentNode.insertBefore(nav, crumb);
  else main.insertBefore(nav, main.firstChild);

  fetch("/api/board/counts", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c) return;
      const tag = (n: number) => (n > 0 ? ` <span class="bb-flag">${n} new</span>` : "");
      const m = document.getElementById("bb-nav-messages");
      const t = document.getElementById("bb-nav-mentions");
      if (m) m.innerHTML = "Messages" + tag(c.messages ?? 0);
      if (t) t.innerHTML = "Mentions" + tag(c.mentions ?? 0);
    })
    .catch(() => {});
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBoardNav);
  } else {
    mountBoardNav();
  }
}


/* ---------------------------------------------------------------
   Saved drafts
   ---------------------------------------------------------------
   Whatever someone types in a post box is kept in their browser as they
   type, and put back if they come back to the same page: a phone that
   locked, a wrong tap, a tab that closed. It's cleared when they send it.
   Nothing goes to the server until they press the button.
   --------------------------------------------------------------- */
const DRAFT_DAYS = 14;

function draftKey(field: HTMLTextAreaElement): string | null {
  // Only the main boxes, which have an id. The little edit boxes under a
  // post don't, and would all share one draft.
  if (!field.id) return null;
  return `board-draft:${window.location.pathname}${window.location.search}#${field.id}`;
}

export function attachDraft(field: HTMLTextAreaElement): void {
  const key = draftKey(field);
  if (!key || field.dataset.draft === "1") return;
  field.dataset.draft = "1";

  const save = () => {
    try {
      if (field.value.trim()) {
        localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: field.value }));
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Private mode or a full disk: no draft, nothing else lost.
    }
  };

  try {
    const raw = localStorage.getItem(key);
    if (raw && !field.value.trim()) {
      const d = JSON.parse(raw) as { t: number; v: string };
      if (Date.now() - d.t < DRAFT_DAYS * 24 * 60 * 60 * 1000 && d.v) {
        field.value = d.v;
        const note = document.createElement("p");
        note.className = "bb-draft-note";
        note.innerHTML = `Your draft was saved and is back. <button type="button" class="underline">Throw it away</button>`;
        note.querySelector("button")?.addEventListener("click", () => {
          field.value = "";
          save();
          note.remove();
        });
        field.insertAdjacentElement("beforebegin", note);
      } else {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // An unreadable draft is just no draft.
  }

  let timer: number | undefined;
  field.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 400);
  });
  // Sending clears it. If the send fails the words are still in the box,
  // so they're put back a few seconds later.
  field.form?.addEventListener("submit", () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to clear
    }
    window.setTimeout(() => {
      if (field.value.trim()) save();
    }, 4000);
  });
}

/* ---------------------------------------------------------------
   Larger text
   ---------------------------------------------------------------
   One button that makes everything bigger, remembered between visits,
   for the people who'd rather not squint.
   --------------------------------------------------------------- */
const LARGE_KEY = "board-large-text";

function largeTextOn(): boolean {
  try {
    return localStorage.getItem(LARGE_KEY) === "1";
  } catch {
    return false;
  }
}

function applyLargeText(): void {
  document.documentElement.classList.toggle("bb-large", largeTextOn());
}

function wireTextSize(button: HTMLElement): void {
  const label = () => (largeTextOn() ? "Normal text size" : "Larger text");
  button.textContent = label();
  button.addEventListener("click", (event) => {
    event.preventDefault();
    try {
      localStorage.setItem(LARGE_KEY, largeTextOn() ? "0" : "1");
    } catch {
      // can't remember it, but it still works for this page
      document.documentElement.classList.toggle("bb-large");
    }
    applyLargeText();
    button.textContent = label();
  });
}

if (typeof document !== "undefined" && window.location.pathname.startsWith("/board/")) {
  applyLargeText();
  const wireLink = () => {
    const link = document.getElementById("text-size-link");
    if (link) wireTextSize(link);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireLink);
  else wireLink();
}
