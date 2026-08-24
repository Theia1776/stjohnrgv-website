/**
 * Cloudflare Pages Function: GET /api/calendar?date=YYYY-MM-DD
 *
 * Server-side proxy + parser for Holy Trinity Orthodox Church's calendar
 * (https://www.holytrinityorthodox.com). Their endpoint returns HTML; we
 * fetch it server-to-server (no CORS) and emit JSON the calendar page can
 * consume.
 *
 * Returns:
 *   {
 *     week_title: string,                   // e.g. "Fourth Sunday of Pascha: The Paralyzed Man"
 *     tone:       number | null,            // 1..8 or null when not a Sunday cycle
 *     saints:     string[],                 // plain-text commemorations (links/img stripped)
 *     readings:   { reference, url }[],     // each scripture reading + upstream link
 *     troparia:   string,                   // raw text block with newlines preserved
 *     fasting:    { kind, season, rule, raw },  // the day's fasting discipline
 *   }
 */

interface Reading {
  reference: string;
  url: string;
}

/**
 * The day's fasting discipline, read from the upstream calendar rather
 * than computed here — HTC already accounts for the fixed and movable
 * cycles, so their line is the authority.
 *
 *   kind   "fast" | "fish" | "none" — what the banner leads with.
 *   season the named fast this day belongs to ("Great Lent",
 *          "Dormition (Theotokos) Fast"), or null on an ordinary
 *          Wednesday/Friday that belongs to no season.
 *   rule   the discipline itself ("Strict Fast (Bread, Vegetables,
 *          Fruits)", "Food with Oil", "Fish Allowed"), or null.
 *   raw    the upstream line, tags stripped — kept so the page can
 *          fall back to it if the split ever goes wrong.
 */
interface Fasting {
  kind: "fast" | "fish" | "none";
  season: string | null;
  rule: string | null;
  raw: string;
}

interface Saint {
  name: string;
  url: string | null;
}

interface CalendarData {
  week_title: string;
  tone: number | null;
  saints: Saint[];
  readings: Reading[];
  troparia: string;
  fasting: Fasting;
}

const TONE_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8,
  first: 1, second: 2, third: 3, fourth: 4,
  fifth: 5, sixth: 6, seventh: 7, eighth: 8,
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// For single-line content (saints, readings refs).
// Drops every tag, decodes entities, collapses runs of whitespace.
function stripInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

// For multi-line content (troparia). Converts <br> and </p> to newlines,
// strips remaining tags, decodes entities, normalizes spacing while
// preserving the line breaks.
function stripBlock(html: string): string {
  let s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Collapse spaces/tabs but keep newlines
  s = s.replace(/[ \t]+/g, " ");
  // Trim each line, drop blank-line runs to a max of one blank line
  s = s
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * Extract the inner content between a header <p class="..."> and the
 * next <p class="..."> (or end of doc), then unwrap the
 * <span class="normaltext">…</span> wrapper that always follows.
 */
function extractSection(
  html: string,
  headerPattern: RegExp,
): { raw: string; afterHeader: number } | null {
  const headerMatch = headerPattern.exec(html);
  if (!headerMatch) return null;
  const afterHeader = headerMatch.index + headerMatch[0].length;
  const remainder = html.slice(afterHeader);
  // Stop at the next <p class="..."> header
  const nextHeader = /<p\s+class="/i.exec(remainder);
  const raw = nextHeader
    ? remainder.slice(0, nextHeader.index)
    : remainder;
  return { raw, afterHeader };
}

function unwrapNormaltext(s: string): string {
  return s
    .replace(/^[\s\S]*?<span\s+class="normaltext"[^>]*>/i, "")
    .replace(/<\/span>\s*$/i, "");
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
function parseFasting(html: string): Fasting {
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
  // Friday, and the banner says so on its own.
  if (season && /^fast\.?$/i.test(season)) season = null;

  return { kind: /fish/i.test(raw) ? "fish" : "fast", season, rule, raw };
}

function parseCalendar(html: string): CalendarData {
  // ---- Fasting ----
  const fasting = parseFasting(html);

  // ---- Title + Tone ----
  // Pattern: <span class="headerheader">TITLE. Tone WORD.<br>
  //          <span class="headerfast">FASTING</span></span>
  const headerInnerMatch = /<span\s+class="headerheader"[^>]*>([\s\S]*?)<\/span>/i
    .exec(html);
  let week_title = "";
  let tone: number | null = null;
  if (headerInnerMatch) {
    // Drop the nested fasting span first — on a day with no tone the
    // title is everything that's left, and the fasting line would
    // otherwise be swept into it.
    const headerHtml = headerInnerMatch[1].replace(
      /<span\s+class="headerfast"[^>]*>[\s\S]*?(?:<\/span>|$)/i,
      "",
    );
    const headerText = stripInline(headerHtml);
    // Title is everything before ". Tone WORD"; tone is the WORD.
    const toneMatch = /^([\s\S]*?)\.\s*Tone\s+([\w-]+)/i.exec(headerText);
    if (toneMatch) {
      week_title = toneMatch[1].trim();
      const word = toneMatch[2].toLowerCase();
      const asInt = parseInt(word, 10);
      tone = !Number.isNaN(asInt) ? asInt : (TONE_WORDS[word] ?? null);
    } else {
      // No tone (e.g. weekdays without a Sunday cycle reference)
      week_title = headerText.replace(/\.\s*$/, "").trim();
    }
  }

  // ---- Saints ----
  // Section between <p class="pheaderheader"> and the next major header.
  const saints: Saint[] = [];
  const saintsSection = extractSection(
    html,
    /<p\s+class="pheaderheader"[\s\S]*?<\/p>/i,
  );
  if (saintsSection) {
    const inner = unwrapNormaltext(saintsSection.raw);
    // Each saint occupies one <br>-terminated line.
    for (const rawLine of inner.split(/<br\s*\/?>/i)) {
      // Drop typicon icon-stand-in spans entirely so their inner glyph
      // (e.g. "1", "0", "o") doesn't bleed into the saint's name.
      const cleaned = rawLine.replace(
        /<span\s+class="typicon-[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
        "",
      );
      // First <a href> on the line points at the saint's Lives page.
      // Saint lines that name multiple persons may have several <a>;
      // we surface the first as the canonical URL for the bullet. A
      // line with no <a> (e.g. minor commemorations without a Life
      // page) gets url: null.
      const linkMatch = /<a\s+[^>]*href="([^"]+)"[^>]*>/i.exec(cleaned);
      const url = linkMatch ? linkMatch[1].trim() : null;
      const name = stripInline(cleaned);
      if (name) saints.push({ name, url });
    }
  }

  // ---- Readings ----
  const readings: Reading[] = [];
  const readingsSection = extractSection(
    html,
    /<p\s+class="pscriptureheader"[\s\S]*?<\/p>/i,
  );
  if (readingsSection) {
    const inner = unwrapNormaltext(readingsSection.raw);
    // Each reading: <a ... href="URL">REFERENCE</a> [optional context]<br>
    const linkRe = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([^<]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(inner)) !== null) {
      const url = m[1].trim();
      const ref = stripInline(m[2]);
      const ctx = stripInline(m[3] || "");
      const reference = ctx ? `${ref} ${ctx}` : ref;
      if (ref) readings.push({ reference, url });
    }
  }

  // ---- Troparia ----
  // The troparia header's exact class name isn't documented; anything
  // matching <p class="...tropar...">...</p> qualifies. Today's response
  // doesn't include this section, so we return an empty string in that
  // case.
  let troparia = "";
  const troparSection = extractSection(
    html,
    /<p\s+class="[^"]*tropar[^"]*"[\s\S]*?<\/p>/i,
  );
  if (troparSection) {
    const inner = unwrapNormaltext(troparSection.raw);
    troparia = stripBlock(inner);
  }

  return { week_title, tone, saints, readings, troparia, fasting };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Edge-cache for an hour. Each ?date=… is a distinct cache entry,
      // so day-to-day changes are not affected.
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function onRequestGet(
  context: { request: Request },
): Promise<Response> {
  const url = new URL(context.request.url);
  const dateParam = url.searchParams.get("date");

  let year: number;
  let month: number;
  let day: number;

  if (dateParam) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
    if (!m) {
      return jsonResponse(
        { error: "Invalid date format. Use YYYY-MM-DD." },
        400,
      );
    }
    year = parseInt(m[1], 10);
    month = parseInt(m[2], 10);
    day = parseInt(m[3], 10);
    // Reject obviously bad dates (basic sanity, no calendar math)
    if (
      month < 1 || month > 12 ||
      day < 1 || day > 31 ||
      year < 1900 || year > 2200
    ) {
      return jsonResponse(
        { error: "Date out of range." },
        400,
      );
    }
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
    day = now.getUTCDate();
  }

  // The legacy /calendar/calendar.php endpoint silently ignores its
  // mm/dd/yy params and returns today's data regardless, AND never
  // returns troparia. Use the v2 endpoint that the live HTC calendar
  // widget itself loads (loadCalendar2_v2 in their loadCalendar_v2.js):
  // path is /htc/ocalendar/v2calendar.php, params are month/today/year
  // /dt/header/lives/trp/scripture, plus a random sid cache-buster.
  const sid = Math.floor(Math.random() * 1e9);
  const upstream =
    `https://www.holytrinityorthodox.com/htc/ocalendar/v2calendar.php` +
    `?month=${month}&today=${day}&year=${year}` +
    `&dt=1&header=1&lives=1&trp=1&scripture=1` +
    `&sid=${sid}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StJohnRGV-Calendar)",
        "Referer": "https://www.holytrinityorthodox.com/htc/orthodox-calendar/",
      },
    });
  } catch (_e) {
    return jsonResponse(
      { error: "Failed to reach Holy Trinity calendar." },
      502,
    );
  }

  if (!upstreamRes.ok) {
    return jsonResponse(
      { error: `Upstream returned ${upstreamRes.status}.` },
      502,
    );
  }

  // The endpoint serves Content-Type: text/html; charset=windows-1251.
  // Decode the byte stream with that codec so characters like 0x97
  // ("—" em dash) and other Cyrillic-page glyphs render correctly.
  const buf = await upstreamRes.arrayBuffer();
  const html = new TextDecoder("windows-1251").decode(buf);

  let parsed: CalendarData;
  try {
    parsed = parseCalendar(html);
  } catch (_e) {
    return jsonResponse(
      { error: "Failed to parse upstream calendar HTML." },
      500,
    );
  }

  return jsonResponse(parsed, 200);
}
