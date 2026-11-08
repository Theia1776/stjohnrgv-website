/**
 * The fasting line from Holy Trinity's calendar, parsed.
 *
 * Shared by the two routes that need it: /api/calendar, which returns
 * one day in full, and /api/calendar-month, which returns a whole
 * month's fasting marks for the grid. It lives here rather than being
 * written out twice — a helper copied into two files is how the
 * calendar page came to have two `const NS_MONTHS` and stopped
 * rendering altogether.
 *
 * The upstream is the authority on this, not us. Orthodox fasting
 * depends on both the fixed and the movable cycles, and HTC already
 * works all of it out; computing it here would mean this parish's
 * calendar could disagree with the calendar app in its own footer.
 */

/**
 *   kind   "fast" | "fish" | "none" — what the day leads with.
 *   season the named fast this day belongs to ("Great Lent",
 *          "Nativity (St. Philip's Fast)"), or null on an ordinary
 *          Wednesday or Friday that belongs to no season.
 *   rule   the discipline itself ("Strict Fast (Bread, Vegetables,
 *          Fruits)", "Food with Oil", "Fish Allowed"), or null.
 *   raw    the upstream line with tags stripped, kept so a page can
 *          fall back to it if the split ever goes wrong.
 */
export interface Fasting {
  kind: "fast" | "fish" | "none";
  season: string | null;
  rule: string | null;
  raw: string;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Drops every tag, decodes entities, collapses runs of whitespace. */
export function stripInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read the fasting line out of <span class="headerfast">.
 *
 * Upstream shapes seen across a full year:
 *   (span absent)                                        → no fast today
 *   "Fast. Fish Allowed"                                 → ordinary Wed/Fri, fish
 *   "Fast. By Monastic Charter: Strict Fast (…)"         → ordinary Wed/Fri
 *   "Great Lent. Food with Oil"
 *   "Great Lent. By Monastic Charter - Full abstention from food"
 *   "Dormition (Theotokos) Fast. By Monastic Charter: Strict Fast (…)"
 *   "Nativity (St. Philip's Fast). Food with Oil"
 *
 * Season and rule are separated at the LAST ". " rather than the first:
 * the Nativity Fast's own name contains "St. ", which a first-period
 * split would tear in half.
 */
export function parseFasting(html: string): Fasting {
  const match = /<span\s+class="headerfast"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  const raw = match ? stripInline(match[1]) : "";

  // No span, or an empty one, means no fast is appointed — a fast-free
  // week, or an ordinary day that isn't a Wednesday or Friday.
  if (!raw) return { kind: "none", season: null, rule: null, raw: "" };

  let season: string | null = null;
  let rule: string | null = null;

  const split = raw.lastIndexOf(". ");
  if (split > 0) {
    season = raw.slice(0, split).trim();
    rule = raw.slice(split + 2).trim();
  } else {
    season = raw.replace(/\.\s*$/, "").trim();
  }

  // "By Monastic Charter:" / "By Monastic Charter -" is a preamble, not
  // part of the discipline.
  if (rule) {
    rule = rule.replace(/^By\s+Monastic\s+Charter\s*[:\-–]\s*/i, "").trim() || null;
  }

  // A bare "Fast" names no season — that's an ordinary Wednesday or
  // Friday, and the page says so on its own.
  if (season && /^fast\.?$/i.test(season)) season = null;

  return { kind: /fish/i.test(raw) ? "fish" : "fast", season, rule, raw };
}

/**
 * The upstream URL for one day.
 *
 * `full` asks for the lives, troparia and scripture as well, which the
 * day view needs and the month grid does not — 252 bytes against 7.4 KB,
 * and the grid asks for thirty-one of them at once.
 *
 * The legacy /calendar/calendar.php endpoint silently ignores its date
 * params and returns today regardless, so this is the v2 endpoint the
 * live HTC widget itself loads, with a random sid cache-buster.
 */
export function htcUrl(year: number, month: number, day: number, full: boolean): string {
  const sid = Math.floor(Math.random() * 1e9);
  return (
    `https://www.holytrinityorthodox.com/htc/ocalendar/v2calendar.php` +
    `?month=${month}&today=${day}&year=${year}` +
    `&dt=1&header=1` +
    (full ? `&lives=1&trp=1&scripture=1` : ``) +
    `&sid=${sid}`
  );
}

export const HTC_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; StJohnRGV-Calendar)",
  Referer: "https://www.holytrinityorthodox.com/htc/orthodox-calendar/",
} as const;

/** The endpoint serves windows-1251; decode with that codec or em dashes arrive as mojibake. */
export async function fetchHtc(url: string): Promise<string> {
  const res = await fetch(url, { headers: HTC_HEADERS });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}.`);
  return new TextDecoder("windows-1251").decode(await res.arrayBuffer());
}
