#!/usr/bin/env node
/**
 * scripts/push-to-r2.mjs
 *
 * Put PDFs into the R2 bucket — files only, no catalogue entries.
 *
 * The catalogue rows are made afterwards by the site itself, from the
 * admin page ("Add books found in storage"), which uses the server's own
 * Supabase key. That split means the only credential needed here is the
 * R2 token, and nobody has to go fetch a second secret.
 *
 * A file whose name is already in the bucket is skipped, never
 * overwritten: the 221 books already in the library live there under
 * their own filenames, and a name that matches is the same book.
 *
 * Credentials: scripts/r2-credentials.json (git-ignored).
 *
 * Usage:
 *   node scripts/push-to-r2.mjs "<folder>"        # that folder, recursively
 *   node scripts/push-to-r2.mjs "<folder>" --max 40   # skip files over 40 MB
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const MB = 1024 * 1024;

const credsFile = path.join(here, "r2-credentials.json");
if (!fs.existsSync(credsFile)) {
  console.error(`Missing ${credsFile}`);
  process.exit(1);
}
const creds = JSON.parse(fs.readFileSync(credsFile, "utf8"));
creds.bucket ||= "library";

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

/** Sign and send one S3 request. R2 speaks S3; SigV4 is its handshake. */
async function s3(method, key, body) {
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const uri = `/${creds.bucket}/${key.split("/").map(uriEncode).join("/")}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? "");

  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, uri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  let signingKey = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  for (const part of ["auto", "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return fetch(`https://${host}${uri}`, {
    method,
    headers: {
      "Content-Type": "application/pdf",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
}

function findPdfs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // _shrunk holds reworked copies; oversize-test was scratch work.
    if (entry.isDirectory()) {
      if (entry.name === "_shrunk" || entry.name === "oversize-test") continue;
      out.push(...findPdfs(full));
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      out.push(full);
    }
  }
  return out;
}

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node scripts/push-to-r2.mjs "<folder>" [--max 40]');
  process.exit(1);
}
const maxIndex = process.argv.indexOf("--max");
const maxBytes = maxIndex !== -1 ? Number(process.argv[maxIndex + 1]) * MB : Infinity;

const files = findPdfs(folder).sort();
console.log(`${files.length} PDF(s) under ${folder}\n`);

let uploaded = 0;
let already = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

for (const [i, file] of files.entries()) {
  const key = path.basename(file);
  const size = fs.statSync(file).size;
  const label = `[${i + 1}/${files.length}] ${key} (${(size / MB).toFixed(1)} MB)`;

  if (size > maxBytes) {
    skipped++;
    console.log(`${label}  too big for this pass`);
    continue;
  }

  try {
    const head = await s3("HEAD", key);
    if (head.status === 200) {
      already++;
      continue;
    }
    const put = await s3("PUT", key, fs.readFileSync(file));
    if (!put.ok) throw new Error(`HTTP ${put.status} ${(await put.text()).slice(0, 120)}`);
    uploaded++;
    bytes += size;
    console.log(`${label}  uploaded`);
  } catch (err) {
    failed++;
    console.log(`${label}  FAILED: ${err.message}`);
  }
}

console.log(
  `\nUploaded ${uploaded} (${(bytes / 1024 / MB).toFixed(2)} GB), ` +
    `${already} already there, ${skipped} too big, ${failed} failed.`,
);
