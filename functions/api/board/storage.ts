/**
 * Cloudflare Pages Function: GET /api/board/storage
 *
 * Admin only. How much of the free 10 GB the file bucket (library,
 * board photos, board attachments) is using. Also sends the 8 GB
 * warning email if that line has just been crossed.
 */

import { requireBoardAccess, jsonResponse, type BoardEnv } from "../../../src/lib/board-access.ts";
import { FREE_BYTES, WARN_AT, bucketUsage, checkStorageAlert, gbLabel } from "../../../src/lib/storage-watch.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Admins only." }, 403));

  try {
    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket?.list) return wrap(jsonResponse({ error: "File storage isn't connected." }, 503));

    const { bytes, objects } = await bucketUsage(bucket);
    await checkStorageAlert(supabase, context.env, bytes);

    return wrap(
      jsonResponse(
        {
          bytes,
          objects,
          used: gbLabel(bytes),
          free: gbLabel(FREE_BYTES),
          percent: Math.round((bytes / FREE_BYTES) * 100),
          warn: bytes >= WARN_AT[0],
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
