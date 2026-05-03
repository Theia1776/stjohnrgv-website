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
 *   }
 */

interface Reading {
  reference: string;
  url: string;
}

interface CalendarData {
  week_title: string;
  tone: number | null;
  saints: string[];
  readings: Reading[];
  troparia: string;
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

function parseCalendar(html: string): CalendarData {
  // ---- Title + Tone ----
  // Pattern: <span class="headerheader">TITLE. Tone WORD.<br>...</span>
  const headerInnerMatch = /<span\s+class="headerheader"[^>]*>([\s\S]*?)<\/span>/i
    .exec(html);
  let week_title = "";
  let tone: number | null = null;
  if (headerInnerMatch) {
    const headerText = stripInline(headerInnerMatch[1]);
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
  const saints: string[] = [];
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
      const text = stripInline(cleaned);
      if (text) saints.push(text);
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

  return { week_title, tone, saints, readings, troparia };
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
