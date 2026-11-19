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

/**
 * What somebody wrote, ready to drop into the page: escaped, with
 * blank lines becoming paragraphs and single newlines becoming line
 * breaks. No markdown, no HTML — if a person types <b> they see <b>.
 */
export function renderBody(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br />")}</p>`)
    .join("");
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
