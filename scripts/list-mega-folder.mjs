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
import { writeFile } from "node:fs/promises";

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
    else if (node.t === 0) files.push({ name: attrs.n, size: Number(node.s ?? 0), parent: node.p });
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

const link = process.argv[2];
if (!link) {
  console.error("Usage: node scripts/list-mega-folder.mjs \"<mega folder link>\" [--json out.json]");
  process.exit(1);
}

const files = await listFolder(link);
const jsonIndex = process.argv.indexOf("--json");

if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  await writeFile(process.argv[jsonIndex + 1], JSON.stringify(files, null, 2), "utf8");
  console.log(`${files.length} files → ${process.argv[jsonIndex + 1]}`);
} else {
  for (const f of files) {
    const mb = (f.size / 1024 / 1024).toFixed(1);
    console.log(`${f.folder ? f.folder + "/" : ""}${f.name}  (${mb} MB)`);
  }
  console.log(`\n${files.length} files.`);
}
