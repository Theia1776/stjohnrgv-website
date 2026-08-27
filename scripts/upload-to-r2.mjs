#!/usr/bin/env node
/**
 * scripts/upload-to-r2.mjs
 *
 * Put a folder of PDFs into the parish library: the file goes to
 * Cloudflare R2, its catalogue row goes to Supabase, and its text —
 * with page numbers — is extracted on the way past.
 *
 * This is the path for bulk work. The upload form on /admin/library/
 * does the same job one book at a time, but runs inside a Worker with
 * 128 MB of memory, so it can't take the giants. Here there's no such
 * limit: R2 accepts files far larger than Supabase ever did.
 *
 * Every book lands as HIDDEN (staging), exactly like the June batches,
 * so nothing appears to parishioners until an admin promotes it from
 * /admin/library/.
 *
 * Idempotent: a slug already in the catalogue is skipped, so re-running
 * after a stop, a crash, or a fixed title costs nothing.
 *
 * ---------------------------------------------------------------
 * Credentials — both git-ignored, never printed:
 *
 *   scripts/service-role.txt     Supabase service-role key (one line)
 *   scripts/r2-credentials.json  {
 *                                  "accountId": "...",
 *                                  "accessKeyId": "...",
 *                                  "secretAccessKey": "...",
 *                                  "bucket": "library"
 *                                }
 *
 * The R2 pair comes from Cloudflare → R2 → API → "Manage API tokens" →
 * Create token with Object Read & Write on the `library` bucket.
 * ---------------------------------------------------------------
 *
 * Usage:
 *   node scripts/upload-to-r2.mjs "<folder>"                  # whole folder
 *   node scripts/upload-to-r2.mjs "<folder>" --category History
 *   node scripts/upload-to-r2.mjs "<folder>" --dry-run        # say what it would do
 *   node scripts/upload-to-r2.mjs "<folder>" --limit 20       # first 20 only
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SUPABASE_URL = "https://untczlsqrwcmqgqvvgmh.supabase.co";
const here = import.meta.dirname;

// ---------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------
function readServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  for (const name of ["service-role.txt", "service-role.local"]) {
    const file = path.join(here, name);
    if (fs.existsSync(file)) {
      const key = fs.readFileSync(file, "utf8").trim();
      // The file has held other things before now; a service key is a JWT.
      if (key.startsWith("ey")) return key;
    }
  }
  console.error(
    "No Supabase service-role key found.\n" +
      `Put it on one line in ${path.join(here, "service-role.txt")}\n` +
      "(Supabase dashboard -> Project Settings -> API -> service_role).",
  );
  process.exit(1);
}

function readR2Credentials() {
  const file = path.join(here, "r2-credentials.json");
  if (!fs.existsSync(file)) {
    console.error(
      "No R2 credentials found.\n" +
        `Create ${file} with:\n` +
        '  { "accountId": "...", "accessKeyId": "...", "secretAccessKey": "...", "bucket": "library" }\n' +
        "From Cloudflare -> R2 -> API -> Manage API tokens -> Create token\n" +
        "(Object Read & Write, scoped to the library bucket).",
    );
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const field of ["accountId", "accessKeyId", "secretAccessKey"]) {
    if (!creds[field]) {
      console.error(`r2-credentials.json is missing "${field}".`);
      process.exit(1);
    }
  }
  creds.bucket ||= "library";
  return creds;
}

// ---------------------------------------------------------------
// S3 request signing (SigV4)
//
// R2 speaks the S3 API, and S3 authenticates by signing a canonical
// description of the request. Doing it by hand keeps this script free of
// the enormous AWS SDK for what amounts to forty lines of hashing.
// ---------------------------------------------------------------
/**
 * RFC 3986 encoding, which is what SigV4 signs over.
 * encodeURIComponent leaves ! ' ( ) * alone; AWS and R2 do not, and a
 * book called "... (In Greek).pdf" fails the signature check without
 * this.
 */
function uriEncode(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

async function putObject(creds, key, body, contentType = "application/pdf") {
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key.split("/").map(uriEncode).join("/");
  const canonicalUri = `/${creds.bucket}/${encodedKey}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  let signingKey = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  for (const part of ["auto", "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`R2 refused the upload (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------
// Reading the book
// ---------------------------------------------------------------
function slugify(input) {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

/**
 * Titles and authors out of a filename. This archive uses two shapes:
 *
 *   "The Ladder of Divine Ascent - St John Klimakos.pdf"   title first
 *   "Saint John of Damascus-Writings.pdf"                  author first
 *
 * A spaced hyphen means the first half is the title. A bare hyphen only
 * splits when what precedes it reads as a person — otherwise it's just
 * a hyphenated word, and cutting there would mangle the title.
 */
const NAME_START = /^(saint|st\.?|father|fr\.?|blessed|elder|abbot|archbishop|bishop|metropolitan|patriarch|pope|monk|nun|hieromonk|archimandrite|venerable)/i;

function looksLikePerson(text) {
  const trimmed = text.trim();
  if (NAME_START.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  // Two to four words, each capitalised: "Nicholas Cabasilas".
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((w) => /^[A-ZÀ-Þ][\w'’.-]*$/.test(w))
  );
}

function fromFilename(filename) {
  const base = filename.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

  const spaced = base.split(/\s+[-–—]\s+/);
  if (spaced.length >= 2) {
    return { title: spaced[0].trim(), author: spaced.slice(1).join(" - ").trim() };
  }

  // "Saint John of Damascus-Writings (Fathers of the Church)"
  const bare = base.match(/^([^-–—]{4,60})[-–—](.{4,})$/);
  if (bare && looksLikePerson(bare[1])) {
    return { title: bare[2].trim(), author: bare[1].trim() };
  }

  return { title: base, author: "" };
}

/**
 * Text, page markers, and a page count — the same shape the browser
 * uploader produces, so books added here behave identically in the
 * reader. Done by a small Python helper because PyMuPDF is already
 * installed for the shrinker and reads PDFs far better than anything
 * available here.
 */
function extractText(pdfPath) {
  try {
    const output = execFileSync(
      "python",
      [path.join(here, "extract-text.py"), pdfPath],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(output);
  } catch (err) {
    return { text: "", pages: 0, status: "error", note: String(err.message ?? err).slice(0, 200) };
  }
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------
function flag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const folder = process.argv[2];
if (!folder || folder.startsWith("--")) {
  console.error('Usage: node scripts/upload-to-r2.mjs "<folder>" [--category X] [--dry-run] [--limit N]');
  process.exit(1);
}

const dryRun = Boolean(flag("--dry-run", false));
const defaultCategory = flag("--category", "Other");
const limit = Number(flag("--limit", 0)) || 0;

const files = fs
  .readdirSync(folder, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
  .map((e) => path.join(folder, e.name))
  .sort();

if (files.length === 0) {
  console.error(`No PDFs in ${folder}`);
  process.exit(1);
}

const toDo = limit ? files.slice(0, limit) : files;
console.log(`${toDo.length} PDF(s) in ${folder}${dryRun ? "  (dry run)" : ""}\n`);

const supabase = dryRun ? null : createClient(SUPABASE_URL, readServiceKey());
const r2 = dryRun ? null : readR2Credentials();

let added = 0;
let skipped = 0;
let failed = 0;

for (const [i, file] of toDo.entries()) {
  const filename = path.basename(file);
  const size = fs.statSync(file).size;
  const guess = fromFilename(filename);
  const slug = slugify(guess.title);
  const label = `[${i + 1}/${toDo.length}] ${filename} (${(size / 1048576).toFixed(1)} MB)`;

  if (dryRun) {
    console.log(`${label}\n      title="${guess.title}" author="${guess.author}" slug=${slug}`);
    continue;
  }

  try {
    const { data: existing } = await supabase
      .from("library_books")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      skipped++;
      console.log(`${label}  already in the catalogue`);
      continue;
    }

    process.stdout.write(`${label}  reading… `);
    const extracted = extractText(file);

    process.stdout.write("uploading… ");
    const body = fs.readFileSync(file);
    await putObject(r2, filename, body);

    const { error } = await supabase.from("library_books").insert({
      slug,
      title: guess.title,
      author: guess.author || null,
      category: defaultCategory,
      languages: ["English"],
      description: null,
      pdf_storage_key: filename,
      hidden: true,
      public_access: false,
      text_content: extracted.text || null,
      text_chars: (extracted.text || "").length,
      text_pages: extracted.pages || 0,
      text_status: extracted.status,
      text_extracted_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    added++;
    console.log(`done (${extracted.pages || 0} pages of text)`);
  } catch (err) {
    failed++;
    console.log(`failed: ${err.message}`);
  }
}

console.log(`\nAdded ${added}, skipped ${skipped}, failed ${failed}.`);
if (added) console.log("All staged as Hidden — promote them from /admin/library/ when ready.");
