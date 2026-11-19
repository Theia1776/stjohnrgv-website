/**
 * Cloudflare Pages Function: POST /api/board/close-request
 *
 * { id, reason? }   the person who started a topic asks the moderators
 *                   to close it to new replies.
 *
 * It doesn't close anything. It writes a new topic in the Moderation
 * Forum, from the person asking, with a link to the topic and their
 * reason, and notes on the topic itself that a request is waiting so
 * it can't be sent twice and moderators can see which ones have one.
 * A moderator then closes the topic or turns the request down.
 *
 * Only the author of the topic may ask, and only while it's open.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

const MAX_REASON = 1000;
const MAX_TITLE = 160;

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    let body: { id?: unknown; reason?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Which topic?" }, 400));
    if (reason.length > MAX_REASON) {
      return wrap(jsonResponse({ error: `Keep it to ${MAX_REASON} characters or fewer.` }, 400));
    }

    const { data: thread, error: threadError } = await supabase
      .from("board_threads")
      .select("id, title, author_id, locked, close_requested_at, board_categories ( name, hidden, audience )")
      .eq("id", id)
      .maybeSingle();
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));

    const room = thread
      ? ((thread as Record<string, unknown>).board_categories as
          | { name: string; hidden: boolean; audience: string }
          | null)
      : null;
    if (!thread || (room && !canSeeCategory(viewer, room))) {
      return wrap(jsonResponse({ error: "That topic is gone." }, 404));
    }
    if (thread.author_id !== viewer.id) {
      return wrap(
        jsonResponse({ error: "Only the person who started a topic can ask for it to be closed." }, 403),
      );
    }
    if (thread.locked) {
      return wrap(jsonResponse({ error: "That topic is already closed." }, 409));
    }
    if (thread.close_requested_at) {
      return wrap(
        jsonResponse({ error: "You've already asked. A moderator will get to it." }, 409),
      );
    }

    const { data: moderation } = await supabase
      .from("board_categories")
      .select("id")
      .eq("slug", "moderation")
      .maybeSingle();
    if (!moderation) {
      return wrap(
        jsonResponse({ error: "The Moderation Forum isn't set up yet, so the request has nowhere to go." }, 500),
      );
    }

    const origin = new URL(context.request.url).origin;
    const topicTitle = thread.title as string;
    const title = `Close request: ${topicTitle}`.slice(0, MAX_TITLE);
    const text =
      `${viewer.displayName} asked for this topic to be closed to new replies.\n\n` +
      `Topic: "${topicTitle}" in ${room?.name ?? "the board"}\n` +
      `${origin}/board/thread/?id=${id}\n\n` +
      `Their reason:\n${reason || "(none given)"}\n\n` +
      `To act on it, open the topic: there is a notice at the top with Close this topic ` +
      `and Turn down the request.`;

    const { data: request, error: requestError } = await supabase
      .from("board_threads")
      .insert({ category_id: moderation.id, title, author_id: viewer.id })
      .select("id")
      .single();
    if (requestError) return wrap(jsonResponse({ error: requestError.message }, 500));

    const { error: postError } = await supabase
      .from("board_posts")
      .insert({ thread_id: request.id, author_id: viewer.id, body: text });
    if (postError) {
      await supabase.from("board_threads").delete().eq("id", request.id);
      return wrap(jsonResponse({ error: postError.message }, 500));
    }

    const { error: markError } = await supabase
      .from("board_threads")
      .update({ close_requested_at: new Date().toISOString(), close_requested_by: viewer.id })
      .eq("id", id);
    if (markError) return wrap(jsonResponse({ error: markError.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
