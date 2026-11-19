/**
 * Photos on the board: the server-side bookkeeping.
 *
 * The picture files sit in R2 (the LIBRARY_BUCKET binding the library
 * already uses) under board/<photo id>/full.jpg and thumb.jpg. The
 * database row says which post a photo belongs to. Deleting a post
 * deletes its rows by cascade but cannot reach into R2, so every route
 * that removes posts calls purgePhotos() first.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface R2Object {
  body: ReadableStream | null;
}

export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export const MAX_PHOTOS_PER_POST = 4;
/** The browser aims well under these; the server refuses past them. */
export const MAX_FULL_BYTES = 1_000_000;
export const MAX_THUMB_BYTES = 200_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPhotoId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function photoKey(id: string, size: "full" | "thumb"): string {
  return `board/${id}/${size}.jpg`;
}

/** Same-origin URL the page uses as an <img src>. Needs the session. */
export function photoUrl(id: string, size: "full" | "thumb"): string {
  return `/api/board/photo?id=${id}&size=${size}`;
}

/** Every JPEG starts FF D8 FF. A cheap check that it really is one. */
export function looksLikeJpeg(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes.slice(0, 3));
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Postgres is happy with a long IN list, but not an enormous one. */
function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Delete the files and rows for these photos, or for every photo on
 * these posts. Safe to call with nothing to do. If R2 isn't connected
 * the rows still go; nothing could have been uploaded without it.
 */
export async function purgePhotos(
  supabase: SupabaseClient,
  bucket: R2Bucket | undefined,
  where: { postIds?: string[]; photoIds?: string[] },
): Promise<void> {
  const ids: string[] = [];

  for (const group of chunks(where.postIds ?? [])) {
    const { data } = await supabase.from("board_photos").select("id").in("post_id", group);
    for (const row of data ?? []) ids.push(row.id as string);
  }
  for (const id of where.photoIds ?? []) ids.push(id);
  if (!ids.length) return;

  if (bucket) {
    for (const group of chunks(ids, 250)) {
      await bucket.delete(group.flatMap((id) => [photoKey(id, "full"), photoKey(id, "thumb")]));
    }
  }
  for (const group of chunks(ids)) {
    await supabase.from("board_photos").delete().in("id", group);
  }
}

/** The ids of every post in these threads. */
export async function postIdsInThreads(
  supabase: SupabaseClient,
  threadIds: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const group of chunks(threadIds)) {
    const { data } = await supabase.from("board_posts").select("id").in("thread_id", group);
    for (const row of data ?? []) out.push(row.id as string);
  }
  return out;
}

/**
 * Hang the photos a person just added on the post they just wrote.
 * Only their own, only ones not yet on a post, and never more than
 * four on a post in total. Anything that doesn't qualify is ignored
 * rather than failing a post that was otherwise fine.
 */
export async function attachPhotos(
  supabase: SupabaseClient,
  viewerId: string,
  postId: string,
  requested: unknown,
): Promise<number> {
  if (!Array.isArray(requested) || !requested.length) return 0;
  const ids = [...new Set(requested.filter(isPhotoId))];
  if (!ids.length) return 0;

  const { count } = await supabase
    .from("board_photos")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId);
  const room = MAX_PHOTOS_PER_POST - (count ?? 0);
  if (room <= 0) return 0;

  const { data, error } = await supabase
    .from("board_photos")
    .update({ post_id: postId })
    .in("id", ids.slice(0, room))
    .eq("uploader_id", viewerId)
    .is("post_id", null)
    .select("id");
  return error ? 0 : (data?.length ?? 0);
}
