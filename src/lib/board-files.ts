/**
 * File attachments on the board: the server-side bookkeeping.
 *
 * Same plan as photos (src/lib/board-photos.ts): the files sit in R2
 * under board-files/<id>, the database row says which post they belong
 * to, and every route that removes posts calls purgeFiles() first
 * because deleting a row cannot reach into R2.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { R2Bucket } from "./board-photos.ts";

/** Everyone but admins. Small on purpose: the free 10 GB is shared with the library. */
export const MEMBER_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Admins have no limit of their own. This is the most one request can
 * safely hold in memory on the free Cloudflare plan, so it is the real
 * ceiling for a single file.
 */
export const ADMIN_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_POST = 6;
export const EXPIRY_DAYS = 30;

/** Files that can run in a browser or on a computer. Not accepted from anyone. */
const BLOCKED = new Set([
  "html", "htm", "xhtml", "svg", "js", "mjs", "css", "php", "exe", "msi", "bat", "cmd", "com",
  "scr", "sh", "ps1", "vbs", "jar", "apk", "dmg", "app", "dll", "lnk", "hta",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFileId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function fileKey(id: string): string {
  return `board-files/${id}`;
}

export function fileUrl(id: string): string {
  return `/api/board/file?id=${id}`;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isBlockedName(name: string): boolean {
  return BLOCKED.has(extensionOf(name));
}

/** A file name safe to store and to put in a download header. */
export function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 200) || "file";
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Delete the files and rows for these files, or for every file on
 * these posts. Safe to call with nothing to do.
 */
export async function purgeFiles(
  supabase: SupabaseClient,
  bucket: R2Bucket | undefined,
  where: { postIds?: string[]; fileIds?: string[] },
): Promise<void> {
  const ids: string[] = [];
  for (const group of chunks(where.postIds ?? [])) {
    const { data } = await supabase.from("board_files").select("id").in("post_id", group);
    for (const row of data ?? []) ids.push(row.id as string);
  }
  for (const id of where.fileIds ?? []) ids.push(id);
  if (!ids.length) return;

  if (bucket) {
    for (const group of chunks(ids, 250)) await bucket.delete(group.map(fileKey));
  }
  for (const group of chunks(ids)) {
    await supabase.from("board_files").delete().in("id", group);
  }
}

/** Remove files whose 30 days are up, and ones picked but never posted. */
export async function purgeExpiredFiles(
  supabase: SupabaseClient,
  bucket: R2Bucket | undefined,
): Promise<void> {
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: expired } = await supabase
    .from("board_files")
    .select("id")
    .lt("expires_at", now)
    .limit(100);
  const { data: stale } = await supabase
    .from("board_files")
    .select("id")
    .is("post_id", null)
    .lt("created_at", dayAgo)
    .limit(100);
  const ids = [...(expired ?? []), ...(stale ?? [])].map((r) => r.id as string);
  if (ids.length) await purgeFiles(supabase, bucket, { fileIds: ids });
}

/**
 * Hang the files a person just added on the post they just wrote.
 * Only their own, only ones not yet on a post. A file marked "30 days"
 * starts its 30 days now. Anything that doesn't qualify is ignored
 * rather than failing a post that was otherwise fine.
 */
export async function attachFiles(
  supabase: SupabaseClient,
  viewerId: string,
  postId: string,
  requested: unknown,
): Promise<number> {
  if (!Array.isArray(requested) || !requested.length) return 0;
  const ids = [...new Set(requested.filter(isFileId))];
  if (!ids.length) return 0;

  const { count } = await supabase
    .from("board_files")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId);
  const room = MAX_FILES_PER_POST - (count ?? 0);
  if (room <= 0) return 0;

  const { data: mine } = await supabase
    .from("board_files")
    .select("id, keep_days")
    .in("id", ids.slice(0, room))
    .eq("uploader_id", viewerId)
    .is("post_id", null);

  let attached = 0;
  for (const f of mine ?? []) {
    const expires = f.keep_days
      ? new Date(Date.now() + (f.keep_days as number) * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const { error } = await supabase
      .from("board_files")
      .update({ post_id: postId, expires_at: expires })
      .eq("id", f.id as string);
    if (!error) attached += 1;
  }
  return attached;
}
