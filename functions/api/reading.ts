/**
 * Cloudflare Pages Function: GET /api/reading?url=<HTC reading URL>
 *
 * Server-side proxy + parser for individual Holy Trinity scripture
 * reading pages (the URLs surfaced by /api/calendar). Fetches the page
 * (no CORS), strips the table-based markup, and returns clean JSON
 * the calendar page can render in its own modal.
 *
 * Returns:
 *   {
 *     reference: string,   // e.g. "Hebrews 10:35-11:7 (Thursday)"
 *     verses:    string,   // one verse per line, "NUM TEXT" format
 *   }
 *
 * The ?url= must point at holytrinityorthodox.com — anything else is
 * rejected to keep this from being a generic open proxy.
 */

interface ReadingData {
  reference: string;
  verses: string;
}

const ALLOWED_HOSTS = new Set([
  "www.holytrinityorthodox.com",
  "holytrinityorthodox.com",
]);

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

function stripInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parseReading(html: string): ReadingData {
  // Reference: <p class="ofd_los_header">Hebrews 10:35-11:7 (Thursday) </p>
  let reference = "";
  const refMatch = /<p\s+class="ofd_los_header"[^>]*>([\s\S]*?)<\/p>/i
    .exec(html);
  if (refMatch) {
    reference = stripInline(refMatch[1]);
  }

  // Verses: each <tr> in the table has two <td>; the first carries
  // <sup>NUM</sup> and the second carries the verse <p class="ofd_los_body">.
  const verseLines: string[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html)) !== null) {
    const rowInner = row[1];
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cell: RegExpExecArray | null;
    while ((cell = cellRe.exec(rowInner)) !== null) {
      cells.push(cell[1]);
    }
    if (cells.length < 2) continue;
    const numMatch = /<sup[^>]*>([\s\S]*?)<\/sup>/i.exec(cells[0]);
    const num = numMatch ? stripInline(numMatch[1]) : "";
    const text = stripInline(cells[1]);
    if (text) {
      verseLines.push(num ? `${num} ${text}` : text);
    }
  }

  return { reference, verses: verseLines.join("\n") };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Edge-cache each (url) response for an hour. Reading pages are
      // immutable historical content, so this is safe.
      "Cache-Control": "public, max-age=3600",
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

  // SSRF guard: only allow Holy Trinity's calendar host. Anything else
  // is rejected so this endpoint can't be turned into an open proxy.
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    return jsonResponse(
      { error: "URL host not allowed." },
      400,
    );
  }
  // Force https — some legacy URLs in HTC's calendar response come
  // back as http://, but the site supports https just fine.
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

  // Reading pages are UTF-8 (verified via Content-Type header), unlike
  // the calendar pages which are windows-1251. Use the default text()
  // decoding which honors the charset.
  const html = await upstreamRes.text();

  let parsed: ReadingData;
  try {
    parsed = parseReading(html);
  } catch (_e) {
    return jsonResponse(
      { error: "Failed to parse reading page." },
      500,
    );
  }

  return jsonResponse(parsed, 200);
}
