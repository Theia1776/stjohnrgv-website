/**
 * Keeping an eye on the free storage.
 *
 * Cloudflare R2 holds the library, the board's photos and the board's
 * attachments in one bucket, and the first 10 GB is free. This adds up
 * everything in the bucket and, the first time it passes 8 GB (and
 * again at 9.5 GB), emails the master admin so there is time to clear
 * space before anything is charged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./email.ts";
import type { R2Bucket } from "./board-photos.ts";

const GB = 1024 * 1024 * 1024;
export const FREE_BYTES = 10 * GB;
/** Warn here, then once more here. */
export const WARN_AT = [8 * GB, 9.5 * GB];

export function gbLabel(bytes: number): string {
  return `${(bytes / GB).toFixed(bytes < 10 * GB ? 2 : 1)} GB`;
}

/** Add up every object in the bucket. A few list calls, not one per file. */
export async function bucketUsage(bucket: R2Bucket): Promise<{ bytes: number; objects: number }> {
  let bytes = 0;
  let objects = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const res = await bucket.list?.({ cursor, limit: 1000 });
    if (!res) break;
    for (const o of res.objects) {
      bytes += o.size;
      objects += 1;
    }
    if (!res.truncated) break;
    cursor = res.cursor;
  }
  return { bytes, objects };
}

interface AlertEnv {
  RESEND_API_KEY?: string;
  RESET_EMAIL_FROM?: string;
}

/**
 * Send the warning if a threshold has just been crossed and hasn't been
 * mentioned before. Safe to call often; it only does real work when the
 * number is over a line it hasn't already reported.
 */
export async function checkStorageAlert(
  supabase: SupabaseClient,
  env: AlertEnv,
  usedBytes: number,
): Promise<void> {
  const crossed = WARN_AT.filter((t) => usedBytes >= t);
  if (!crossed.length) return;
  const line = crossed[crossed.length - 1];
  const key = `storage-${line / GB}gb`;

  const { data: already } = await supabase.from("site_alerts").select("key").eq("key", key).maybeSingle();
  if (already) return;
  if (!env.RESEND_API_KEY || !env.RESET_EMAIL_FROM) return;

  const { data: owners } = await supabase
    .from("profiles")
    .select("email, first_name")
    .eq("is_master_admin", true);
  if (!owners?.length) return;

  // Mark it first, so two uploads at once don't send it twice.
  const { error } = await supabase.from("site_alerts").insert({ key });
  if (error) return;

  const text =
    `The parish website's file storage is now at ${gbLabel(usedBytes)} of the 10 GB that is free.\n\n` +
    `That is past the ${gbLabel(line)} warning line. Nothing is wrong yet, and nothing is being charged, ` +
    `but past 10 GB the storage starts to cost money.\n\n` +
    `The easy ways to make room:\n` +
    `- Delete old board attachments, or attach new ones with "Remove it after 30 days".\n` +
    `- Remove duplicate or unneeded books from the library.\n\n` +
    `The current number is always shown at the top of the Admin section on the Parish Board.\n\n` +
    `This message is sent once for each warning line.`;

  for (const o of owners) {
    if (!o.email) continue;
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.RESET_EMAIL_FROM,
      to: o.email as string,
      subject: `Parish website storage is at ${gbLabel(usedBytes)} of 10 GB`,
      text,
    });
  }
}
