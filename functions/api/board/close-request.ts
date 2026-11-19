/**
 * Cloudflare Pages Function: POST /api/board/close-request
 *
 * { id, reason? }   the person who started a topic presses Help.
 *
 * It doesn't close anything. It opens a private conversation between
 * that person and the moderators and admins, with a link to the topic
 * and what they said, and notes on the topic itself that help was asked
 * for, so it isn't sent twice and moderators can see which topics have
 * one waiting. Any moderator can answer in the conversation, and the
 * person hears back there. A moderator then closes the topic or
 * dismisses the request, from the notice at the top of the topic.
 *
 * Only the author of the topic may ask, and only while it's open.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
  suspensionBlock,
} from "../../../src/lib/board-access.ts";
import { MAX_SUBJECT, postMessage, privilegedIds } from "../../../src/lib/board-messages.ts";

const MAX_REASON = 1000;

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

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

    const origin = new URL(context.request.url).origin;
    const topicTitle = thread.title as string;
    const subject = `Help: ${topicTitle}`.slice(0, MAX_SUBJECT);
    const text =
      `I'd like help with my topic "${topicTitle}"${room ? ` in ${room.name}` : ""}.
` +
      `${origin}/board/thread/?id=${id}

` +
      (reason || "(I didn't add anything more.)");

    const { data: made, error: makeError } = await supabase
      .from("board_conversations")
      .insert({ kind: "help", subject, created_by: viewer.id, thread_id: id })
      .select("id")
      .single();
    if (makeError) return wrap(jsonResponse({ error: makeError.message }, 500));

    try {
      await postMessage(supabase, made.id as string, viewer.id, text, [...(await privilegedIds(supabase))]);
    } catch (err) {
      await supabase.from("board_conversations").delete().eq("id", made.id);
      return wrap(
        jsonResponse({ error: err instanceof Error ? err.message : "Couldn't send that." }, 500),
      );
    }

    // Also a note in the Moderation Forum, so the moderators and admins
    // see it in the room they already check. Answering still happens in
    // Messages, privately with the person.
    try {
      const { data: room2 } = await supabase
        .from("board_categories")
        .select("id")
        .eq("slug", "moderation")
        .maybeSingle();
      if (room2) {
        const { data: note } = await supabase
          .from("board_threads")
          .insert({
            category_id: room2.id,
            title: `Help requested: ${topicTitle}`.slice(0, 160),
            author_id: viewer.id,
          })
          .select("id")
          .single();
        if (note) {
          await supabase.from("board_posts").insert({
            thread_id: note.id,
            author_id: viewer.id,
            body:
              `${viewer.displayName} asked the moderators for help with their topic "${topicTitle}"` +
              `${room ? ` in ${room.name}` : ""}.\n\n` +
              `Topic: ${origin}/board/thread/?id=${id}\n\n` +
              `What they said:\n${reason || "(nothing added)"}\n\n` +
              `Answer them privately in your Messages, or close the topic from the notice at the top of it.`,
          });
        }
      }
    } catch {
      // The private message above still went out.
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
