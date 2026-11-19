/**
 * Cloudflare Pages Function: POST /api/board/event-item
 *
 * { itemId, claim }   say "I'll bring this" (claim: true) or take it back
 *                     (claim: false) on an event's please-bring list.
 *
 * An item can be claimed by one person. Taking one back is for whoever
 * claimed it, the person hosting, or a moderator.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  suspensionBlock,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    const body = (await context.request.json().catch(() => ({}))) as { itemId?: unknown; claim?: unknown };
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!itemId) return wrap(jsonResponse({ error: "Which item?" }, 400));

    const { data: item } = await supabase
      .from("board_event_items")
      .select("id, claimed_by, board_events ( board_threads ( author_id, locked, board_categories ( hidden, audience ) ) )")
      .eq("id", itemId)
      .maybeSingle();
    const thread = item
      ? (((item as Record<string, unknown>).board_events as {
          board_threads: { author_id: string | null; locked: boolean; board_categories: { hidden: boolean; audience: string } | null } | null;
        } | null)?.board_threads ?? null)
      : null;
    if (!item || !thread || (thread.board_categories && !canSeeCategory(viewer, thread.board_categories))) {
      return wrap(jsonResponse({ error: "That item is gone." }, 404));
    }

    if (body.claim === false) {
      const allowed =
        item.claimed_by === viewer.id || thread.author_id === viewer.id || viewer.isModerator;
      if (!allowed) return wrap(jsonResponse({ error: "Only the person who said they'd bring it can take it back." }, 403));
      const { error } = await supabase
        .from("board_event_items")
        .update({ claimed_by: null, claimed_at: null })
        .eq("id", itemId);
      if (error) return wrap(jsonResponse({ error: error.message }, 500));
      return wrap(jsonResponse({ ok: true }, 200));
    }

    if (thread.locked) return wrap(jsonResponse({ error: "This event is closed." }, 403));
    if (item.claimed_by && item.claimed_by !== viewer.id) {
      return wrap(jsonResponse({ error: "Someone has already said they'll bring that." }, 409));
    }
    // Only if it's still free, so two people pressing at once can't both win.
    const { data: won, error } = await supabase
      .from("board_event_items")
      .update({ claimed_by: viewer.id, claimed_at: new Date().toISOString() })
      .eq("id", itemId)
      .or(`claimed_by.is.null,claimed_by.eq.${viewer.id}`)
      .select("id");
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    if (!won?.length) return wrap(jsonResponse({ error: "Someone has already said they'll bring that." }, 409));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
