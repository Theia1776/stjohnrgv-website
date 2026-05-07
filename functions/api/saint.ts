/**
 * Cloudflare Pages Function: GET /api/saint?url=<HTC saint Life URL>
 *
 * Server-side proxy + parser for individual Holy Trinity "Lives of
 * Saints" pages (the URLs surfaced by the calendar's saints links).
 * Returns clean JSON the calendar page can render in a modal.
 *
 * Returns:
 *   {
 *     name:         string,   // "The Monk Theodore the Trikhinian"
 *     commemorated: string,   // "Commemorated on April 20"
 *     life:         string,   // biography body, paragraph breaks preserved
 *     attribution:  string,   // copyright / translator credit if present
 *   }
 *
 * SSRF guard: holytrinityorthodox.com only.
 *
 * The pages are served as windows-1251, same as the v2 calendar
 * endpoint, so we read the response as ArrayBuffer and decode with
 * `new TextDecoder("windows-1251")`. Lives are effectively immutable;
 * cache for 24 hours at the edge.
 */

interface SaintData {
  name: string;
  commemorated: string;
  life: string;
  attribution: string;
}

const ALLOWED_HOSTS = new Set([
  "www.holytrinityorthodox.com",
  "holytrinityorthodox.com",
]);

// Sentinel chars used by stripBlock to mark real line breaks BEFORE
// collapsing all whitespace, then restored to newlines afterward.
// U+0001 and U+0002 are control characters that don't appear in normal
// text and are not matched by \s.
const BR_SENTINEL = "";
const PP_SENTINEL = "";

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

// For single-line content (saint name). Drops every tag, collapses
// runs of whitespace (including the literal newlines inside multi-line
// names like "The Monk Theodore\nthe Trikhinian").
function stripInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

// For the life-text body. Browsers treat literal newlines inside HTML
// text as whitespace, but the raw HTML is line-wrapped at the source
// (mid-sentence). Tag the real breaks (<br> and </p>) with sentinel
// chars first, then collapse ALL whitespace, then restore the
// sentinels to newlines.
function stripBlock(html: string): string {
  let s = html
    .replace(/<br\s*\/?>/gi, BR_SENTINEL)
    .replace(/<\/p>/gi, PP_SENTINEL)
    .replace(/<p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Collapse all whitespace runs (incl. literal \n from source wrap
  // and U+00A0 from &nbsp;) to a single space. Sentinels survive
  // because they are not in \s.
  s = s.replace(/\s+/g, " ");
  // Restore real breaks: <br> = single newline; </p> = paragraph
  // break (two newlines).
  s = s.split(BR_SENTINEL).join("\n");
  s = s.split(PP_SENTINEL).join("\n\n");
  // Trim each line, collapse 3+ blank lines.
  s = s
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function parseSaint(html: string): SaintData {
  // Name: <p class="ofd_los_header">NAME</p>
  let name = "";
  const nameMatch = /<p\s+class="ofd_los_header"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (nameMatch) {
    name = stripInline(nameMatch[1]);
  }

  // Walk every <p class="ofd_los_body">…</p> in document order. The
  // first typically holds "Commemorated on …", the middle one(s) the
  // life text, and the last the © translator attribution. Categorize
  // by shape so a missing piece doesn't mislabel the others.
  let commemorated = "";
  let attribution = "";
  const lifeParts: string[] = [];

  const paraRe = /<p\s+class="ofd_los_body"[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(html)) !== null) {
    const text = stripBlock(m[1]);
    if (!text) continue;

    if (/Commemorated\s+on/i.test(text) && text.length < 120) {
      commemorated = text;
      continue;
    }
    if (/^©|^\(c\)\s|^Copyright/i.test(text)) {
      attribution = text;
      continue;
    }
    lifeParts.push(text);
  }

  return {
    name,
    commemorated,
    life: lifeParts.join("\n\n"),
    attribution,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Lives of Saints are effectively immutable; cache aggressively.
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export async function onRequestGet(
  context: { request: Request },
): Promise<Response> {
  const reqUrl = new URL(context.request.url);
  const urlParam = reqUrl.searchParams.get("url");

  if (!urlParam) {
    return jsonResponse(
      { error: "Missing required ?url= parameter." },
      400,
    );
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch (_e) {
    return jsonResponse({ error: "Invalid url parameter." }, 400);
  }

  // SSRF guard: only Holy Trinity. Anything else is a 400.
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    return jsonResponse(
      { error: "URL host not allowed." },
      400,
    );
  }
  // Some legacy URLs come back as http://; the site supports https.
  if (target.protocol !== "https:") {
    target.protocol = "https:";
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StJohnRGV-Calendar)",
        "Referer":
          "https://www.holytrinityorthodox.com/htc/orthodox-calendar/",
      },
    });
  } catch (_e) {
    return jsonResponse(
      { error: "Failed to reach Holy Trinity." },
      502,
    );
  }

  if (!upstreamRes.ok) {
    return jsonResponse(
      { error: `Upstream returned ${upstreamRes.status}.` },
      502,
    );
  }

  // The calendar v2 endpoint serves windows-1251; the Lives of
  // Saints pages serve UTF-8. Sniff the Content-Type header so each
  // page is decoded with the encoding it was actually produced in.
  const buf = await upstreamRes.arrayBuffer();
  const ct = upstreamRes.headers.get("content-type") || "";
  const charsetMatch = /charset=([^;\s]+)/i.exec(ct);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : "utf-8";
  const decoderLabel = charset === "windows-1251" ? "windows-1251" : "utf-8";
  const html = new TextDecoder(decoderLabel).decode(buf);

  let parsed: SaintData;
  try {
    parsed = parseSaint(html);
  } catch (_e) {
    return jsonResponse(
      { error: "Failed to parse saint Life page." },
      500,
    );
  }

  return jsonResponse(parsed, 200);
}
