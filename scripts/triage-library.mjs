/**
 * Triage a folder of library PDFs before bulk upload.
 *
 * Separates out two kinds of files so the uploader only sees clean input:
 *   1. OVERSIZE  — PDFs larger than the 50MB storage-bucket cap.
 *   2. DUPLICATE — byte-identical PDFs (same SHA-256). The first copy
 *                  (alphabetically) is kept; the rest are moved aside.
 *
 * Also flags ZERO-BYTE (incomplete) files.
 *
 * Dry-run by default — prints what it WOULD do and moves nothing.
 * Pass --apply to actually move files into:
 *     <folder>/_oversize/      and      <folder>/_duplicates/
 *
 * Optionally cross-checks a metadata JSON for titles that collapse to the
 * same slug (those would be silently skipped by the uploader's slug de-dupe).
 *
 * Usage:
 *   node scripts/triage-library.mjs "<books-folder>" [metadata.json]            # dry run
 *   node scripts/triage-library.mjs "<books-folder>" [metadata.json] --apply    # move files
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_BYTES = 50 * 1024 * 1024;

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const folder = args[0];
const metaPath = args[1];

if (!folder || !fs.existsSync(folder)) {
  console.error(`Books folder not found: ${folder}`);
  process.exit(1);
}

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

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function move(file, destDir) {
  if (!APPLY) return;
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(file, path.join(destDir, path.basename(file)));
}

const pdfs = fs
  .readdirSync(folder)
  .filter((f) => /\.pdf$/i.test(f))
  .sort();

const oversizeDir = path.join(folder, "_oversize");
const dupDir = path.join(folder, "_duplicates");

let oversize = 0, empty = 0, dups = 0, kept = 0;
const byHash = new Map();

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${pdfs.length} PDF(s) in ${folder}\n`);

for (const file of pdfs) {
  const full = path.join(folder, file);
  const size = fs.statSync(full).size;

  if (size === 0) {
    console.log(`• EMPTY (0 bytes): ${file}`);
    empty++;
    continue;
  }
  if (size > MAX_BYTES) {
    console.log(`• OVERSIZE (${(size / 1024 / 1024).toFixed(0)}MB): ${file}  -> _oversize/`);
    move(full, oversizeDir);
    oversize++;
    continue;
  }

  const hash = sha256(full);
  if (byHash.has(hash)) {
    console.log(`• DUPLICATE of "${byHash.get(hash)}": ${file}  -> _duplicates/`);
    move(full, dupDir);
    dups++;
  } else {
    byHash.set(hash, file);
    kept++;
  }
}

// Optional: title/slug collisions in the metadata (not file-identical, but
// would still be skipped by the uploader because slugs must be unique).
if (metaPath && fs.existsSync(metaPath)) {
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const bySlug = new Map();
  for (const m of meta) {
    const s = slugify(m.title);
    bySlug.set(s, (bySlug.get(s) || []).concat(m.title));
  }
  const colliding = [...bySlug].filter(([, t]) => t.length > 1);
  console.log(`\n=== metadata slug collisions (only the FIRST of each uploads) ===`);
  if (!colliding.length) console.log("  none");
  for (const [s, titles] of colliding) console.log(`  [${s}] -> ${titles.join("  |  ")}`);
}

console.log(
  `\n${APPLY ? "Moved" : "Would move"}: ${oversize} oversize, ${dups} duplicate.  ` +
  `Kept ${kept} unique, ${empty} empty flagged.` +
  (APPLY ? "" : "\nRe-run with --apply to actually move them."),
);
