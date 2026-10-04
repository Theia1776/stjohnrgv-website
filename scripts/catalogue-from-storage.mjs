#!/usr/bin/env node
/**
 * scripts/catalogue-from-storage.mjs
 *
 * A catalogue of the library, built by listing the R2 bucket and
 * reading titles and authors out of the filenames.
 *
 * This exists for the case where the catalogue is wanted but a Supabase
 * key isn't to hand — the bucket needs only the R2 token, which lives
 * in scripts/r2-credentials.json. The authoritative titles are the ones
 * in the database, and the admin page's "Export list" produces those in
 * one press; use this when that isn't available.
 *
 * Filenames in this archive come in two shapes:
 *   "The Ladder of Divine Ascent - St John Klimakos.pdf"   title first
 *   "Saint John of Damascus-Writings.pdf"                  author first
 * A bare hyphen only splits when what precedes it reads as a person, so
 * "Well-Ordered Prayer" stays whole.
 *
 * Writes three files beside each other:
 *   parish-library-catalogue.md    grouped A–Z, for reading
 *   parish-library-catalogue.csv   for a spreadsheet
 *   parish-library-catalogue.txt   plain list, one book a line
 *
 * Usage:
 *   node scripts/catalogue-from-storage.mjs [--out <folder>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const creds = JSON.parse(fs.readFileSync(path.join(here, "r2-credentials.json"), "utf8"));
creds.bucket ||= "library";

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1 ? path.resolve(process.argv[outIndex + 1]) : path.resolve(here, "..");
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------
// Listing the bucket (S3 ListObjectsV2, signed by hand)
// ---------------------------------------------------------------
const uriEncode = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const sha256hex = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

async function listPage(token) {
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const params = new Map([["list-type", "2"], ["max-keys", "1000"]]);
  if (token) params.set("continuation-token", token);
  // The canonical query string must be sorted by key, encoded.
  const canonicalQuery = [...params.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const uri = `/${creds.bucket}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex("");
  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["GET", uri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  let signingKey = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  for (const part of ["auto", "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const res = await fetch(`https://${host}${uri}?${canonicalQuery}`, {
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  if (!res.ok) throw new Error(`R2 listing failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.text();
}

/** Keys and sizes out of the XML, without pulling in a parser. */
function parseListing(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? "";
    const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
    if (key) {
      out.push({
        key: key
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'"),
        size,
      });
    }
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { out, truncated, token };
}

// ---------------------------------------------------------------
// Title and author out of a filename
// ---------------------------------------------------------------
const NAME_START =
  /^(saint|st\.?|father|fr\.?|blessed|elder|abbot|archbishop|bishop|metropolitan|patriarch|pope|monk|nun|hieromonk|archimandrite|venerable|ed\.?|edited)\b/i;

function looksLikePerson(text) {
  const trimmed = text.trim();
  if (NAME_START.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-ZÀ-Þ][\w'’.-]*$/.test(w));
}

/**
 * A filename that is really a slug — "iberian-fathers-volume-1-martin-
 * of-braga" — back into something readable. Small words stay lowercase
 * unless they begin the title.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or",
  "the", "to", "with", "vs",
]);

function deslug(text) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text)) return text;
  return text
    .split("-")
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * The Orthodox Word was scanned issue by issue, and the filenames are
 * the scanner's: a sequence number, a volume/number code, the year, the
 * months, and ENH/SRCH for the enhanced and searchable passes. Ninety
 * or so books in this library are these, and left raw they sort into an
 * unreadable block at the top of any list.
 *
 *   "031 V06N03 1970 May Jun.ENH.SRCH"
 *     → "The Orthodox Word, Vol. 6 No. 3 — May Jun 1970"
 */
function orthodoxWordIssue(base) {
  // The scanner was not consistent: a double issue can be "V06N04 05",
  // a zero was sometimes typed as the letter O ("V07NO5"), and the V and
  // N are sometimes separated. All of it means the same thing.
  const m = /^(?:\d{3}\s+)+V\s*(\d+)\s*N[O0]?\s*([\dNO\s]+?)\s+(\d{4})\s+(.+)$/i.exec(base);
  if (!m) return null;
  const [, volumeRaw, numberRaw, year, rest] = m;
  const volume = String(Number(volumeRaw));
  const digits = numberRaw.replace(/\D/g, "");
  // Four digits is a double issue — 0506 is numbers 5 and 6.
  const number =
    digits.length === 4
      ? `${Number(digits.slice(0, 2))}–${Number(digits.slice(2))}`
      : String(Number(digits));
  const months = rest
    .replace(/\.ENH|\.SRCH|\bENH\b|\bSRCH\b/gi, "")
    .replace(/\bnew\b/gi, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: `The Orthodox Word, Vol. ${volume} No. ${number}${months ? ` — ${months} ${year}` : ` (${year})`}`,
    author: "",
  };
}

function fromFilename(filename) {
  let base = filename
    .replace(/\.pdf$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const issue = orthodoxWordIssue(base);
  if (issue) return issue;

  // Scanner leftovers carry no meaning for a catalogue.
  base = base
    .replace(/\.ENH\.SRCH|\.ENH|\.SRCH/gi, "")
    .replace(/\s+new$/i, "")
    .trim();

  const unslugged = deslug(base);
  if (unslugged !== base) return { title: unslugged, author: "" };

  const spaced = base.split(/\s+[-–—]\s+/);
  if (spaced.length >= 2) {
    const first = spaced[0].trim();
    const rest = spaced.slice(1).join(" - ").trim();
    // "Author - Title" happens too; if the first half reads as a person
    // and the second doesn't, read it that way round.
    if (looksLikePerson(first) && !looksLikePerson(rest)) return { title: rest, author: first };
    return { title: first, author: rest };
  }
  const bare = base.match(/^([^-–—]{4,60})[-–—](.{4,})$/);
  if (bare && looksLikePerson(bare[1])) return { title: bare[2].trim(), author: bare[1].trim() };
  return { title: base, author: "" };
}

// ---------------------------------------------------------------
// Build it
// ---------------------------------------------------------------
const objects = [];
let token;
do {
  const xml = await listPage(token);
  const page = parseListing(xml);
  objects.push(...page.out);
  token = page.truncated ? page.token : undefined;
} while (token);

const books = objects
  .filter((o) => o.key.toLowerCase().endsWith(".pdf"))
  .filter((o) => !o.key.startsWith("catechism/"))
  .map((o) => {
    const { title, author } = fromFilename(o.key.split("/").pop() ?? o.key);
    return { title, author, mb: o.size / 1048576, key: o.key };
  })
  .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));

const lessons = objects.filter((o) => o.key.startsWith("catechism/") && o.key.toLowerCase().endsWith(".pdf"));
const totalGb = books.reduce((n, b) => n + b.mb, 0) / 1024;

// --- Markdown, grouped by first letter ---
const today = new Date().toISOString().slice(0, 10);
const md = [
  "# Parish Library — catalogue",
  "",
  `St John of Kronstadt Orthodox Mission · ${today}`,
  "",
  `**${books.length} books**, ${totalGb.toFixed(2)} GB. Titles and authors are read from`,
  "each file's name, so a few will be rough where the filename was.",
  "",
];
let letter = "";
for (const b of books) {
  const initial = (b.title[0] || "#").toUpperCase();
  const group = /[A-Z]/.test(initial) ? initial : "#";
  if (group !== letter) {
    letter = group;
    md.push("", `## ${letter}`, "");
  }
  md.push(`- **${b.title}**${b.author ? ` — ${b.author}` : ""}`);
}
// --- Likely duplicates ---
// The same book arrived from the old library and from MEGA under
// different filenames, so some are held twice. Worth knowing for a
// records list, and worth tidying in the catalogue one day.
const byNormalised = new Map();
for (const b of books) {
  const normal = b.title
    .toLowerCase()
    .replace(/\bvol(ume)?\.?\s*/g, "v")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (!byNormalised.has(normal)) byNormalised.set(normal, []);
  byNormalised.get(normal).push(b);
}
const duplicates = [...byNormalised.values()].filter((group) => group.length > 1);

if (duplicates.length > 0) {
  md.push("", "---", "", `## Possible duplicates (${duplicates.length})`, "");
  md.push(
    "The same book held twice under different filenames — most arrived once",
    "from the old library and once from the MEGA archive.",
    "",
  );
  for (const group of duplicates) {
    md.push(`- **${group[0].title}**`);
    for (const b of group) md.push(`  - \`${b.key}\` (${b.mb.toFixed(1)} MB)`);
  }
}

md.push("");
fs.writeFileSync(path.join(outDir, "parish-library-catalogue.md"), md.join("\n"), "utf8");

// --- CSV ---
const csvField = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [
  ["Title", "Author", "Size (MB)", "File"],
  ...books.map((b) => [b.title, b.author, b.mb.toFixed(1), b.key]),
]
  .map((r) => r.map(csvField).join(","))
  .join("\r\n");
// A byte-order mark, or Excel turns accented titles into nonsense.
fs.writeFileSync(path.join(outDir, "parish-library-catalogue.csv"), "﻿" + csv, "utf8");

// --- Plain list ---
const txt = [
  `Parish Library — ${books.length} books — ${today}`,
  "",
  ...books.map((b) => (b.author ? `${b.title} — ${b.author}` : b.title)),
  "",
].join("\n");
fs.writeFileSync(path.join(outDir, "parish-library-catalogue.txt"), txt, "utf8");

console.log(`${books.length} books, ${totalGb.toFixed(2)} GB (plus ${lessons.length} catechism lessons, not listed).`);
console.log(`${duplicates.length} title(s) appear to be held more than once.`);
console.log(`Wrote parish-library-catalogue.{md,csv,txt} to ${outDir}`);
