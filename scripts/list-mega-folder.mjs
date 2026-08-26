#!/usr/bin/env node
/**
 * scripts/list-mega-folder.mjs
 *
 * List the files in a public MEGA folder link, so the parish library can
 * be checked against the MEGA archive it was built from.
 *
 * MEGA never sends filenames in the clear: the folder listing comes back
 * with each node's attributes encrypted, and the key that opens them is
 * the fragment after the # in the share link — which never leaves the
 * browser in normal use, and is passed here on the command line. So the
 * work is: ask the API for the folder's nodes, decrypt each node's key
 * with the folder key, then decrypt that node's attributes with its own
 * key to recover the name.
 *
 * Usage:
 *   node scripts/list-mega-folder.mjs "https://mega.nz/folder/XXXX#KEY"
 *   node scripts/list-mega-folder.mjs "https://mega.nz/folder/XXXX#KEY" --json out.json
 *
 * Prints one filename per line (plus size), or writes JSON with --json.
 */
import crypto from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

const API = "https://g.api.mega.co.nz/cs";

// ---------------------------------------------------------------
// MEGA's base64: URL-safe, unpadded.
// ---------------------------------------------------------------
function b64decode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

/** AES-ECB, no padding — how MEGA wraps node keys. */
function decryptKey(data, key) {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * A file's key is 32 bytes that fold down to the 16-byte AES key by
 * XORing the halves; a folder's key is already 16.
 */
function unfoldKey(keyBuffer) {
  if (keyBuffer.length === 16) return keyBuffer;
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = keyBuffer[i] ^ keyBuffer[i + 16];
  return out;
}

/** Node attributes: AES-CBC with a zero IV, prefixed "MEGA" then JSON. */
function decryptAttributes(attrBase64, key) {
  const data = b64decode(attrBase64);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  if (!plain.startsWith("MEGA")) return null;
  try {
    return JSON.parse(plain.slice(4).replace(/\0+$/, ""));
  } catch {
    return null;
  }
}

function parseLink(link) {
  // https://mega.nz/folder/<handle>#<key>   (older links use /#F!handle!key)
  const modern = link.match(/mega\.nz\/folder\/([^#]+)#([^/?]+)/);
  if (modern) return { handle: modern[1], key: modern[2] };
  const legacy = link.match(/mega\.nz\/#F!([^!]+)!([^/?]+)/);
  if (legacy) return { handle: legacy[1], key: legacy[2] };
  throw new Error("That doesn't look like a MEGA folder link.");
}

async function listFolder(link) {
  const { handle, key } = parseLink(link);
  const folderKey = b64decode(key);

  const res = await fetch(`${API}?id=0&n=${encodeURIComponent(handle)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // a:f — fetch nodes; c:1 — include children; r:1 — recurse.
    body: JSON.stringify([{ a: "f", c: 1, r: 1 }]),
  });
  const payload = await res.json();
  if (typeof payload === "number") {
    throw new Error(`MEGA refused the request (error ${payload}).`);
  }
  const nodes = payload?.[0]?.f;
  if (!Array.isArray(nodes)) throw new Error("MEGA returned no file list.");

  const folders = new Map();
  const files = [];

  for (const node of nodes) {
    // node.k is "<owner handle>:<base64 key>"; take the key half.
    const encodedKey = String(node.k ?? "").split(":")[1];
    if (!encodedKey) continue;
    let nodeKey;
    try {
      nodeKey = unfoldKey(decryptKey(b64decode(encodedKey), folderKey));
    } catch {
      continue;
    }
    const attrs = decryptAttributes(node.a, nodeKey);
    if (!attrs?.n) continue;

    if (node.t === 1) folders.set(node.h, { name: attrs.n, parent: node.p });
    else if (node.t === 0) {
      files.push({
        name: attrs.n,
        size: Number(node.s ?? 0),
        parent: node.p,
        handle: node.h,
        // The unfolded 32 bytes: the first half makes the AES key, and
        // bytes 16-24 are the counter block's nonce.
        rawKey: b64decode(encodedKey).length >= 32 ? decryptKey(b64decode(encodedKey), folderKey) : null,
      });
    }
  }

  // Rebuild the path each file sits at, for folders nested in the share.
  const pathOf = (parent) => {
    const parts = [];
    let cursor = parent;
    while (folders.has(cursor)) {
      parts.unshift(folders.get(cursor).name);
      cursor = folders.get(cursor).parent;
    }
    return parts.join("/");
  };

  return files
    .map((f) => ({ ...f, folder: pathOf(f.parent) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch one file and decrypt it as it arrives.
 *
 * MEGA hands back the bytes AES-CTR encrypted. The counter block is the
 * node key's bytes 16-24 followed by eight zero bytes, and the AES key is
 * the two halves of the node key XORed together — the same fold used to
 * read the file's name.
 */
async function downloadFile(folderHandle, file, destination) {
  const res = await fetch(`${API}?id=0&n=${encodeURIComponent(folderHandle)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ a: "g", g: 1, n: file.handle }]),
  });
  const payload = await res.json();
  const info = Array.isArray(payload) ? payload[0] : payload;
  if (typeof info === "number" || !info?.g) {
    throw new Error(`MEGA would not serve this file (${JSON.stringify(info)})`);
  }

  const aesKey = unfoldKey(file.rawKey);
  const counter = Buffer.alloc(16);
  file.rawKey.copy(counter, 0, 16, 24); // nonce; the rest counts up from zero
  const decipher = crypto.createDecipheriv("aes-128-ctr", aesKey, counter);

  const body = await fetch(info.g);
  if (!body.ok || !body.body) throw new Error(`download failed (HTTP ${body.status})`);

  const out = createWriteStream(destination);
  await pipeline(Readable.fromWeb(body.body), decipher, out);
}

function flag(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] ?? true : null;
}

const link = process.argv[2];
if (!link) {
  console.error(
    "Usage:\n" +
      '  node scripts/list-mega-folder.mjs "<link>"                     list everything\n' +
      '  node scripts/list-mega-folder.mjs "<link>" --json out.json     write the listing\n' +
      '  node scripts/list-mega-folder.mjs "<link>" --download <dir> --folder "Catechism"\n',
  );
  process.exit(1);
}

const files = await listFolder(link);
const jsonPath = flag("--json");
const downloadDir = flag("--download");
const folderFilter = flag("--folder");

if (typeof jsonPath === "string") {
  // Keys never go into the listing file — they're the share's secret.
  await writeFile(jsonPath, JSON.stringify(files.map(({ rawKey, ...f }) => f), null, 2), "utf8");
  console.log(`${files.length} files → ${jsonPath}`);
} else if (typeof downloadDir === "string") {
  const { handle: folderHandle } = parseLink(link);
  let wanted = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  if (typeof folderFilter === "string" && folderFilter.trim()) {
    const needle = folderFilter.toLowerCase();
    wanted = wanted.filter((f) => f.folder.toLowerCase().includes(needle));
  }
  // --name picks out individual books, for when a whole folder is more
  // than you want to pull down.
  const nameFilter = flag("--name");
  if (typeof nameFilter === "string" && nameFilter.trim()) {
    const needle = nameFilter.toLowerCase();
    wanted = wanted.filter((f) => f.name.toLowerCase().includes(needle));
  }
  if (wanted.length === 0) {
    console.error("Nothing matched that folder.");
    process.exit(1);
  }

  await mkdir(downloadDir, { recursive: true });
  const totalMb = wanted.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;
  console.log(`${wanted.length} file(s), ${totalMb.toFixed(0)} MB → ${downloadDir}\n`);

  let done = 0;
  let skipped = 0;
  for (const [i, file] of wanted.entries()) {
    // Keep MEGA's filename: it carries the title, and the uploader reads
    // titles from filenames.
    const dest = path.join(downloadDir, file.name.replace(/[\\/:*?"<>|]/g, "-"));
    // Already here at the right size? Leave it. That makes the whole
    // thing resumable, which matters across gigabytes.
    if (existsSync(dest) && statSync(dest).size === file.size) {
      skipped++;
      continue;
    }
    const mb = (file.size / 1024 / 1024).toFixed(1);
    process.stdout.write(`[${i + 1}/${wanted.length}] ${file.name} (${mb} MB) … `);
    try {
      await downloadFile(folderHandle, file, dest);
      done++;
      console.log("ok");
    } catch (err) {
      console.log(`failed: ${err.message}`);
    }
  }
  console.log(`\nDownloaded ${done}, already had ${skipped}.`);
} else {
  for (const f of files) {
    const mb = (f.size / 1024 / 1024).toFixed(1);
    console.log(`${f.folder ? f.folder + "/" : ""}${f.name}  (${mb} MB)`);
  }
  console.log(`\n${files.length} files.`);
}
