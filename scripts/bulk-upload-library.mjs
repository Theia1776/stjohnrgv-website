/**
 * Bulk-upload library books into Supabase as Hidden (staging).
 *
 * Reads a folder of PDFs + a metadata JSON, uploads each PDF to the
 * "library" storage bucket, and inserts a library_books row with
 * hidden = true (and public_access = false). Admins then promote each
 * book to Parishioners / Public from /admin/library.
 *
 * Idempotent: a book whose slug already exists is skipped, so the
 * script is safe to re-run (e.g. after fixing a few entries).
 *
 * Usage:
 *   node scripts/bulk-upload-library.mjs "<books-folder>" [metadata.json]
 *
 * The service-role key is read from (in order):
 *   1. process.env.SUPABASE_SERVICE_ROLE_KEY
 *   2. scripts/service-role.local   (a one-line file you create; gitignored)
 *
 * This key is never printed or committed. Delete the .local file when done.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = "https://untczlsqrwcmqgqvvgmh.supabase.co";
const BUCKET = "library";
const MAX_BYTES = 50 * 1024 * 1024; // matches the upload form / bucket cap

const here = import.meta.dirname;

function readServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  for (const name of ["service-role.txt", "service-role.local"]) {
    const keyFile = path.join(here, name);
    if (fs.existsSync(keyFile)) {
      const k = fs.readFileSync(keyFile, "utf8").trim();
      if (k && !k.startsWith("PASTE")) return k;
    }
  }
  console.error(
    "No service-role key found.\n" +
    `Create ${path.join(here, "service-role.txt")} containing just your Supabase service-role key,\n` +
    "or set SUPABASE_SERVICE_ROLE_KEY in the environment.",
  );
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

function norm(name) {
  return name.replace(/\.pdf$/i, "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const folder = process.argv[2];
const metaPath = process.argv[3] || path.join(here, "library-batch1.json");
// Optional 4th arg: category to use for PDFs that have no metadata entry
// (handy when a whole batch is one kind, e.g. "Hagiography").
const defaultCategory = process.argv[4] || "Other";

if (!folder || !fs.existsSync(folder)) {
  console.error(`Books folder not found: ${folder}`);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const metaByNorm = new Map(meta.map((m) => [norm(m.file), m]));

const supabase = createClient(SUPABASE_URL, readServiceKey(), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const pdfs = fs.readdirSync(folder).filter((f) => /\.pdf$/i.test(f)).sort();

let uploaded = 0, autoCount = 0, skippedExisting = 0, skippedBig = 0, skippedEmpty = 0, failed = 0;

console.log(`Found ${pdfs.length} PDF(s) in ${folder}\n`);

for (const file of pdfs) {
  const full = path.join(folder, file);
  const size = fs.statSync(full).size;
  if (size === 0) {
    console.log(`• SKIP (empty/incomplete): ${file}`);
    skippedEmpty++;
    continue;
  }
  if (size > MAX_BYTES) {
    console.log(`• SKIP (>${MAX_BYTES / 1024 / 1024}MB, ${(size / 1024 / 1024).toFixed(0)}MB): ${file}`);
    skippedBig++;
    continue;
  }

  // Metadata from the JSON if present; otherwise fall back to a filename-
  // derived title so no PDF is ever silently dropped.
  let m = metaByNorm.get(norm(file));
  let auto = false;
  if (!m) {
    auto = true;
    const base = file.replace(/\.pdf$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
    m = { title: base, author: null, category: defaultCategory, description: null };
  }

  const slug = slugify(m.title);

  // Idempotency: skip if a row with this slug already exists.
  const { data: existing } = await supabase
    .from("library_books")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    console.log(`• SKIP (already in catalog): ${m.title}`);
    skippedExisting++;
    continue;
  }

  // Storage keys must be ASCII-safe — Supabase rejects en dashes, etc.
  // Derive the key from the slug rather than the raw filename. De-dupe if
  // the bucket already holds that key.
  let storageKey = `${slug}.pdf`;
  const { data: listed } = await supabase.storage.from(BUCKET).list("", { limit: 1000, search: storageKey });
  if (listed?.some((f) => f.name === storageKey)) {
    const suffix = Math.random().toString(36).slice(2, 10);
    storageKey = `${slug}-${suffix}.pdf`;
  }

  const buffer = fs.readFileSync(full);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storageKey, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    console.log(`✗ FAIL upload: ${m.title} — ${upErr.message}`);
    failed++;
    continue;
  }

  const { error: insErr } = await supabase.from("library_books").insert({
    slug,
    title: m.title,
    author: m.author || null,
    category: m.category || "Other",
    languages: m.languages && m.languages.length ? m.languages : ["English"],
    description: m.description || null,
    pdf_storage_key: storageKey,
    public_access: false,
    hidden: true,
  });
  if (insErr) {
    // Roll back the uploaded blob so we don't orphan it.
    await supabase.storage.from(BUCKET).remove([storageKey]);
    console.log(`✗ FAIL insert: ${m.title} — ${insErr.message}`);
    failed++;
    continue;
  }

  console.log(`✓ ${auto ? "(auto) " : ""}${m.title}  [${m.category}]`);
  uploaded++;
  if (auto) autoCount++;
}

console.log(
  `\nDone. Uploaded ${uploaded} (${autoCount} auto-titled), already-present ${skippedExisting}, ` +
  `too-big ${skippedBig}, empty ${skippedEmpty}, failed ${failed}.`,
);
