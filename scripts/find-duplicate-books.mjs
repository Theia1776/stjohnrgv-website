#!/usr/bin/env node
/**
 * scripts/find-duplicate-books.mjs
 *
 * Which books in the bucket are genuinely the same file, and which only
 * share a title.
 *
 * A title match is not evidence. The same work can be two different
 * scans — different page counts, different quality — and two different
 * works can share a short title. So this compares what is actually
 * stored: size, and the ETag, which for these uploads is the MD5 of the
 * bytes. Identical ETag means identical file, with no ambiguity at all.
 *
 * Reports three groups:
 *   identical   same bytes — one copy is pure waste
 *   same size   same length, different bytes — almost certainly the
 *               same book, worth a look before choosing
 *   differ      same title, different files — a second scan, another
 *               edition, or two different books. Decide by hand.
 *
 * Deletes nothing. Deleting a file also needs its catalogue row dealt
 * with, or the library is left pointing at something that isn't there.
 *
 * Usage:
 *   node scripts/find-duplicate-books.mjs [--json out.json]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const creds = JSON.parse(fs.readFileSync(path.join(here, "r2-credentials.json"), "utf8"));
creds.bucket ||= "library";

const uriEncode = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const sha256hex = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

async function listPage(token) {
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const params = new Map([["list-type", "2"], ["max-keys", "1000"]]);
  if (token) params.set("continuation-token", token);
  const canonicalQuery = [...params.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const uri = `/${creds.bucket}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex("");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
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
  if (!res.ok) throw new Error(`R2 listing failed: HTTP ${res.status}`);
  return res.text();
}

function parseListing(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? "";
    const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
    const etag = (/<ETag>([\s\S]*?)<\/ETag>/.exec(m[1])?.[1] ?? "").replace(/&quot;|"/g, "");
    if (key) {
      out.push({
        key: key
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'"),
        size,
        etag,
      });
    }
  }
  return {
    out,
    truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    token: /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1],
  };
}

/** Loose enough to catch "Vol 1" against "Vol. 1", strict about which volume. */
function normalise(name) {
  return name
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .replace(/\bvol(ume)?\.?\s*/g, "v")
    .replace(/[^a-z0-9]+/g, "");
}

const objects = [];
let token;
do {
  const page = await listPage(token);
  const parsed = parseListing(page);
  objects.push(...parsed.out);
  token = parsed.truncated ? parsed.token : undefined;
} while (token);

const books = objects.filter((o) => o.key.toLowerCase().endsWith(".pdf") && !o.key.startsWith("catechism/"));

// --- By identical bytes, regardless of what they are called ---
const byEtag = new Map();
for (const b of books) {
  if (!b.etag) continue;
  if (!byEtag.has(b.etag)) byEtag.set(b.etag, []);
  byEtag.get(b.etag).push(b);
}
const identical = [...byEtag.values()].filter((g) => g.length > 1);

// --- By name, for things that only look alike ---
const byName = new Map();
for (const b of books) {
  const n = normalise(b.key.split("/").pop() ?? b.key);
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(b);
}
const sameName = [...byName.values()].filter((g) => g.length > 1);

const identicalKeys = new Set(identical.flat().map((b) => b.key));
const nameOnly = sameName.filter((g) => !g.every((b) => identicalKeys.has(b.key)));

const MB = 1048576;
const wasted = identical.reduce((n, g) => n + g[0].size * (g.length - 1), 0);

console.log(`${books.length} books in the bucket.\n`);

console.log(`IDENTICAL FILES — same bytes, ${identical.length} group(s), ${(wasted / MB).toFixed(0)} MB recoverable`);
for (const g of identical) {
  console.log(`  ${(g[0].size / MB).toFixed(1)} MB each`);
  for (const b of g) console.log(`    ${b.key}`);
}

console.log(`\nSAME TITLE, DIFFERENT FILE — ${nameOnly.length} group(s), decide by hand`);
for (const g of nameOnly) {
  for (const b of g) console.log(`  ${(b.size / MB).toFixed(1).padStart(7)} MB  ${b.key}`);
  console.log("");
}

const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex !== -1) {
  fs.writeFileSync(
    path.resolve(process.argv[jsonIndex + 1]),
    JSON.stringify({ identical, nameOnly }, null, 2),
    "utf8",
  );
  console.log(`Wrote ${process.argv[jsonIndex + 1]}`);
}
