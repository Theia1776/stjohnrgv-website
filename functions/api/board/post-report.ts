/**
 * Cloudflare Pages Function: POST /api/board/post-report
 *
 * { postId }   report a post in a topic.
 *
 * Writes a note in the Moderation Forum with a link to the post and a
 * copy of what it said (it was already public to the board). If other
 * people report the same post, their reports are added to the same note
 * rather than starting new ones. Nothing is removed or hidden: a
 * moderator looks and decides.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { GONE, namesOf, overHourlyLimit } from "../../../src/lib/board-messages.ts";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const body = (await context.request.json().catch(() => ({}))) as { postId?: unknown };
    const postId = typeof body.postId === "string" ? body.postId.trim() : "";
    if (!postId) return wrap(jsonResponse({ error: "Which post?" }, 400));

    const { data: post } = await supabase
      .from("board_posts")
      .select("id, author_id, body, thread_id, board_threads ( id, title, board_categories ( name, hidden, audience ) )")
      .eq("id", postId)
      .maybeSingle();
    const thread = post
      ? ((post as Record<string, unknown>).board_threads as
          | { id: string; title: string; board_categories: { name: string; hidden: boolean; audience: string } | null }
          | null)
      : null;
    if (!post || !thread || (thread.board_categories && !canSeeCategory(viewer, thread.board_categories))) {
      return wrap(jsonResponse({ error: "That post is gone." }, 404));
    }
    if (await overHourlyLimit(supabase, viewer.id)) {
      return wrap(jsonResponse({ error: "Try again a little later." }, 429));
    }

    const { data: already } = await supabase
      .from("board_post_reports")
      .select("post_id")
      .eq("post_id", postId)
      .eq("reporter_id", viewer.id)
      .maybeSingle();
    if (already) {
      return wrap(jsonResponse({ ok: true, already: true }, 200));
    }

    // Is there already a note for this post?
    const { data: earlier } = await supabase
      .from("board_post_reports")
      .select("note_thread_id")
      .eq("post_id", postId)
      .not("note_thread_id", "is", null)
      .limit(1);
    let noteId = (earlier?.[0]?.note_thread_id as string | undefined) ?? null;

    const { data: room } = await supabase
      .from("board_categories")
      .select("id")
      .eq("slug", "moderation")
      .maybeSingle();

    const origin = new URL(context.request.url).origin;
    const link = `${origin}/board/thread/?id=${thread.id}#p${postId}`;

    if (room) {
      try {
        if (noteId) {
          await supabase.from("board_posts").insert({
            thread_id: noteId,
            author_id: null,
            body: `${viewer.displayName} also reported this post.`,
          });
        } else {
          const names = await namesOf(supabase, post.author_id ? [post.author_id as string] : []);
          const author = post.author_id ? (names.get(post.author_id as string) ?? GONE) : GONE;
          const date = new Date().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "America/Chicago",
          });
          const { data: note } = await supabase
            .from("board_threads")
            .insert({ category_id: room.id, title: `Post reported, ${date}`, author_id: null })
            .select("id")
            .single();
          if (note) {
            noteId = note.id as string;
            await supabase.from("board_posts").insert({
              thread_id: noteId,
              author_id: null,
              body:
                `${viewer.displayName} reported a post by ${author} in "${thread.title}"` +
                `${thread.board_categories ? ` (${thread.board_categories.name})` : ""}.\n\n` +
                `${link}\n\nThe post is hidden from the board until a moderator restores it: open the topic and press "Restore this post."\n\nWhat it said:\n${post.body}`,
            });
          }
        }
      } catch {
        // The report below is still recorded.
      }
    }

    const { error } = await supabase
      .from("board_post_reports")
      .insert({ post_id: postId, reporter_id: viewer.id, note_thread_id: noteId });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    // Off the board for everyone but moderators until one restores it.
    await supabase.from("board_posts").update({ reported_hidden: true }).eq("id", postId);

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
