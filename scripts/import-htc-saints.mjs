#!/usr/bin/env node
/**
 * scripts/import-htc-saints.mjs
 *
 * Bulk-import saint Lives of Saints from holytrinityorthodox.com into
 * the parish catalog at src/data/saints/. Generates one JSON file per
 * saint matching the schema used by src/lib/saints-lookup.ts.
 *
 * Permission: David Leselidze (developer of the HTC orthodox calendar
 * at holytrinityorthodox.com/htc/calendar.php) granted St. John of
 * Kronstadt Orthodox Mission written permission on 2026-05-05 to embed
 * the calendar, customize the color scheme, and pull/store saints data
 * locally in our catalog.
 *
 * Usage:
 *   node scripts/import-htc-saints.mjs --date 2026-05-06
 *     Pull every saint commemorated on the given Gregorian date.
 *
 *   node scripts/import-htc-saints.mjs --range 2026-05-01:2026-05-31
 *     Iterate all dates in the range, inclusive.
 *
 *   node scripts/import-htc-saints.mjs --year 2026
 *     Pull every saint from January 1 through December 31.
 *
 *   node scripts/import-htc-saints.mjs --url <htc saint Life url>
 *     Pull a single saint by URL (no calendar fetch). Useful for
 *     filling gaps the calendar import skipped.
 *
 * Existing JSON files are never overwritten; the slug check
 * short-circuits on each saint, so the script is safe to re-run. To
 * regenerate one entry, delete its file first.
 *
 * Politeness: 500ms sleep between upstream requests by default
 * (override with --delay <ms>). The script always identifies itself
 * via User-Agent so HTC's logs can correlate.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ============================================================================
// Constants
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SAINTS_DIR = path.join(REPO_ROOT, "src", "data", "saints");

const ALLOWED_HOSTS = new Set([
  "www.holytrinityorthodox.com",
  "holytrinityorthodox.com",
]);

const USER_AGENT = "Mozilla/5.0 (compatible; StJohnRGV-CatalogImport)";
const REFERER = "https://www.holytrinityorthodox.com/htc/orthodox-calendar/";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Hagiographic prefixes peeled off when generating a slug. Mirrors the
// PREFIX_RE in src/lib/saints-lookup.ts so the slugs come out readable
// and consistent with the existing catalog naming.
const PREFIX_WORDS = [
  "the", "saint", "sainted", "holy", "venerable", "monk", "martyr",
  "hieromartyr", "righteous", "apostle", "prophet", "blessed",
  "priestmartyr", "great", "equal-to-the-apostles",
];

// ============================================================================
// HTML parsing helpers (factored from functions/api/calendar.ts and
// functions/api/saint.ts — kept identical so the script's output
// matches what the live calendar page sees)
// ============================================================================

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripInline(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const BR_SENTINEL = "";
const PP_SENTINEL = "";

function stripBlock(html) {
  let s = html
    .replace(/<br\s*\/?>/gi, BR_SENTINEL)
    .replace(/<\/p>/gi, PP_SENTINEL)
    .replace(/<p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ");
  s = s.split(BR_SENTINEL).join("\n");
  s = s.split(PP_SENTINEL).join("\n\n");
  s = s
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function extractSection(html, headerPattern) {
  const headerMatch = headerPattern.exec(html);
  if (!headerMatch) return null;
  const afterHeader = headerMatch.index + headerMatch[0].length;
  const remainder = html.slice(afterHeader);
  const nextHeader = /<p\s+class="/i.exec(remainder);
  return nextHeader ? remainder.slice(0, nextHeader.index) : remainder;
}

function unwrapNormaltext(s) {
  return s
    .replace(/^[\s\S]*?<span\s+class="normaltext"[^>]*>/i, "")
    .replace(/<\/span>\s*$/i, "");
}

/** Parse the calendar HTML for the saints section only. */
function parseCalendarSaints(html) {
  const out = [];
  const raw = extractSection(html, /<p\s+class="pheaderheader"[\s\S]*?<\/p>/i);
  if (!raw) return out;
  const inner = unwrapNormaltext(raw);
  for (const rawLine of inner.split(/<br\s*\/?>/i)) {
    const cleaned = rawLine.replace(
      /<span\s+class="typicon-[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
      "",
    );
    const linkMatch = /<a\s+[^>]*href="([^"]+)"[^>]*>/i.exec(cleaned);
    const url = linkMatch ? linkMatch[1].trim() : null;
    const name = stripInline(cleaned);
    if (name) out.push({ name, url });
  }
  return out;
}

/** Parse a single saint Life page. */
function parseSaintLife(html) {
  let name = "";
  const nameMatch = /<p\s+class="header12"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>[\s\S]*?<\/p>/i
    .exec(html);
  if (nameMatch) name = stripInline(nameMatch[1]);

  let commemorated = "";
  let attribution = "";
  const lifeParts = [];

  const paraRe = /<p\s+class="body10"[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
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

// ============================================================================
// Slug generation — mirrors the spirit of the PREFIX_RE in saints-lookup.ts
// ============================================================================

function slugify(rawName) {
  let n = String(rawName ?? "").toLowerCase();
  // Drop parenthetical / bracketed annotations: "(c. 305)", "[Russian]"
  n = n.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  // Drop year ranges: "1853-1908"
  n = n.replace(/\b\d{3,4}\s*[–-]\s*\d{2,4}\b/g, " ");
  // Strip hagiographic prefix words (one pass, then again, until stable)
  for (let pass = 0; pass < 6; pass++) {
    const before = n;
    for (const word of PREFIX_WORDS) {
      const re = new RegExp("^\\s*" + word.replace(/[-]/g, "\\-") + "s?\\b", "i");
      n = n.replace(re, " ");
    }
    if (n === before) break;
  }
  // Replace non-alphanumeric with dashes, collapse, trim.
  n = n
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  // Cap to a reasonable length so very long titles don't produce
  // unreadable filenames. Existing saints are mostly 2–4 word slugs.
  const MAX_LEN = 60;
  if (n.length > MAX_LEN) {
    n = n.slice(0, MAX_LEN).replace(/-[^-]*$/, "");
  }
  return n || "unknown-saint";
}

/** Extract "Month Day" from "Commemorated on Month Day" / "April 21" / etc. */
function extractFeastDay(commemorated) {
  if (!commemorated) return null;
  const re = new RegExp(
    "(" + MONTHS.join("|") + ")\\s+(\\d{1,2})",
    "i",
  );
  const m = re.exec(commemorated);
  if (!m) return null;
  const month = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return month + " " + parseInt(m[2], 10);
}

// ============================================================================
// Network
// ============================================================================

function calendarUrl(year, month, day) {
  const sid = Math.floor(Math.random() * 1e9);
  return (
    "https://www.holytrinityorthodox.com/htc/ocalendar/v2calendar.php" +
    `?month=${month}&today=${day}&year=${year}` +
    `&dt=1&header=1&lives=1&trp=1&scripture=1` +
    `&sid=${sid}`
  );
}

async function fetchHtcAsText(url) {
  const target = new URL(url);
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error(`Refusing non-HTC host: ${target.hostname}`);
  }
  if (target.protocol !== "https:") target.protocol = "https:";
  const res = await fetch(target.toString(), {
    headers: { "User-Agent": USER_AGENT, "Referer": REFERER },
  });
  if (!res.ok) throw new Error(`HTC ${res.status} for ${url}`);
  // HTC pages are served as windows-1251.
  const buf = await res.arrayBuffer();
  return new TextDecoder("windows-1251").decode(buf);
}

// ============================================================================
// JSON shape
// ============================================================================

function buildSaintJson({ name, slug, feast, life, attribution }) {
  return {
    name: name || "",
    slug,
    feasts: feast ? [feast] : [],
    life: life || "",
    attribution: attribution || "Holy Trinity Orthodox Mission, holytrinityorthodox.com",
    troparion: "",
    kontakion: "",
    iconSlug: "",
  };
}

// ============================================================================
// Per-date import
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function importOneDate(year, month, day, opts) {
  const stamp = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const calHtml = await fetchHtcAsText(calendarUrl(year, month, day));
  const saints = parseCalendarSaints(calHtml);
  if (saints.length === 0) {
    console.log(`[${stamp}] no saints on calendar`);
    return { fetched: 0, saved: 0, skipped: 0 };
  }

  let saved = 0;
  let skipped = 0;
  for (const cal of saints) {
    if (!cal.url) {
      skipped++;
      continue;
    }
    await sleep(opts.delay);
    let lifeHtml;
    try {
      lifeHtml = await fetchHtcAsText(cal.url);
    } catch (err) {
      console.warn(`[${stamp}] fetch failed for ${cal.name}: ${err.message}`);
      skipped++;
      continue;
    }
    const parsed = parseSaintLife(lifeHtml);
    const slug = slugify(parsed.name || cal.name);
    const filePath = path.join(SAINTS_DIR, `${slug}.json`);

    if (existsSync(filePath)) {
      console.log(`[${stamp}] skip (exists): ${slug}`);
      skipped++;
      continue;
    }

    const feast = extractFeastDay(parsed.commemorated);
    const json = buildSaintJson({
      name: parsed.name || cal.name,
      slug,
      feast,
      life: parsed.life,
      attribution: parsed.attribution,
    });

    await writeFile(filePath, JSON.stringify(json, null, 2) + "\n", "utf8");
    console.log(`[${stamp}] + ${slug}`);
    saved++;
  }

  return { fetched: saints.length, saved, skipped };
}

async function importByUrl(url, opts) {
  const lifeHtml = await fetchHtcAsText(url);
  const parsed = parseSaintLife(lifeHtml);
  const slug = slugify(parsed.name || url);
  const filePath = path.join(SAINTS_DIR, `${slug}.json`);
  if (existsSync(filePath)) {
    console.log(`skip (exists): ${slug}`);
    return;
  }
  const feast = extractFeastDay(parsed.commemorated);
  const json = buildSaintJson({
    name: parsed.name,
    slug,
    feast,
    life: parsed.life,
    attribution: parsed.attribution,
  });
  await writeFile(filePath, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`+ ${slug}`);
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const out = { delay: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") out.date = argv[++i];
    else if (a === "--range") out.range = argv[++i];
    else if (a === "--year") out.year = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--delay") out.delay = parseInt(argv[++i], 10) || 500;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  node scripts/import-htc-saints.mjs --date YYYY-MM-DD",
      "  node scripts/import-htc-saints.mjs --range YYYY-MM-DD:YYYY-MM-DD",
      "  node scripts/import-htc-saints.mjs --year YYYY",
      "  node scripts/import-htc-saints.mjs --url <htc saint url>",
      "  node scripts/import-htc-saints.mjs --delay 1000   # ms between requests",
    ].join("\n"),
  );
}

function* dateRange(startIso, endIso) {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  for (let d = start; d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    yield {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  await mkdir(SAINTS_DIR, { recursive: true });

  if (opts.url) {
    await importByUrl(opts.url, opts);
    return;
  }

  let dates = [];
  if (opts.date) {
    const [y, m, d] = opts.date.split("-").map(Number);
    dates.push({ year: y, month: m, day: d });
  } else if (opts.range) {
    const [start, end] = opts.range.split(":");
    if (!start || !end) {
      console.error("--range expects YYYY-MM-DD:YYYY-MM-DD");
      process.exit(1);
    }
    dates = Array.from(dateRange(start, end));
  } else if (opts.year) {
    dates = Array.from(dateRange(`${opts.year}-01-01`, `${opts.year}-12-31`));
  } else {
    printHelp();
    process.exit(1);
  }

  let totalSaved = 0;
  let totalSkipped = 0;
  let totalFetched = 0;
  for (const { year, month, day } of dates) {
    try {
      const r = await importOneDate(year, month, day, opts);
      totalFetched += r.fetched;
      totalSaved += r.saved;
      totalSkipped += r.skipped;
    } catch (err) {
      console.warn(`[${year}-${month}-${day}] failed: ${err.message}`);
    }
    await sleep(opts.delay);
  }

  console.log(
    `\nDone. Fetched ${totalFetched} commemorations across ${dates.length} day(s); saved ${totalSaved}, skipped ${totalSkipped}.`,
  );
  console.log(`Output dir: ${path.relative(REPO_ROOT, SAINTS_DIR)}`);
  console.log(
    "Review the new files, then `git add src/data/saints && git commit` to ship.",
  );
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
