/**
 * Cloudflare Pages Function: /api/board/event
 *
 * POST   { title, hosting, date, start, end?, place, address?, contact?,
 *          gift?, details, items?, rsvp? }
 *        start an event topic in the Events room
 * PATCH  { threadId, ...the same fields, items: [{ id?, label }] }
 *        change an event: whoever started it, or a moderator. The topic's
 *        first post is written again from the fields.
 *
 * The topic's first post is built from the form so every event reads
 * the same way and nothing gets left out.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  suspensionBlock,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { eventBody, parseEvent } from "../../../src/lib/board-events.ts";
import { recordMentions } from "../../../src/lib/board-mentions.ts";
import { logAction } from "../../../src/lib/board-modlog.ts";

const EVENTS_ROOM = "events";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    const raw = await context.request.json().catch(() => null);
    const parsed = parseEvent(raw);
    if (!parsed.ok) return wrap(jsonResponse({ error: parsed.error }, 400));
    const e = parsed.value;

    const { data: room } = await supabase
      .from("board_categories")
      .select("id, hidden, audience")
      .eq("slug", EVENTS_ROOM)
      .maybeSingle();
    if (!room || !canSeeCategory(viewer, room)) {
      return wrap(jsonResponse({ error: "The Events room isn't there." }, 404));
    }

    const { data: thread, error: threadError } = await supabase
      .from("board_threads")
      .insert({ category_id: room.id, title: e.title, author_id: viewer.id })
      .select("id")
      .single();
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));

    const fail = async (message: string) => {
      await supabase.from("board_threads").delete().eq("id", thread.id);
      return wrap(jsonResponse({ error: message }, 500));
    };

    const { data: post, error: postError } = await supabase
      .from("board_posts")
      .insert({ thread_id: thread.id, author_id: viewer.id, body: eventBody(e, viewer.displayName) })
      .select("id")
      .single();
    if (postError) return fail(postError.message);

    const { error: evError } = await supabase.from("board_events").insert({
      thread_id: thread.id,
      hosting: e.hosting,
      event_date: e.date,
      start_time: e.start,
      end_time: e.end,
      place: e.place,
      address: e.address || null,
      contact: e.contact || null,
      gift: e.gift,
    });
    if (evError) return fail(evError.message);

    if (e.items.length) {
      const { error: itemError } = await supabase
        .from("board_event_items")
        .insert(e.items.map((i, position) => ({ thread_id: thread.id, label: i.label, position })));
      if (itemError) return fail(itemError.message);
    }

    if (e.rsvp) {
      const { data: poll } = await supabase
        .from("board_polls")
        .insert({ thread_id: thread.id, multiple: false, question: "Will you be there?", show_voters: true })
        .select("id")
        .single();
      if (poll) {
        await supabase.from("board_poll_options").insert(
          ["Yes, I'll be there", "Maybe", "No, I can't make it"].map((label, position) => ({
            poll_id: poll.id,
            label,
            position,
          })),
        );
      }
    }

    await recordMentions(supabase, post.id as string, viewer.id, e.details);
    await supabase
      .from("board_reads")
      .upsert(
        { user_id: viewer.id, thread_id: thread.id, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,thread_id" },
      );

    return wrap(jsonResponse({ id: thread.id }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestPatch(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    const raw = (await context.request.json().catch(() => null)) as Record<string, unknown> | null;
    const threadId = typeof raw?.threadId === "string" ? raw.threadId : "";
    if (!threadId) return wrap(jsonResponse({ error: "Which event?" }, 400));
    const parsed = parseEvent(raw);
    if (!parsed.ok) return wrap(jsonResponse({ error: parsed.error }, 400));
    const e = parsed.value;

    const { data: thread } = await supabase
      .from("board_threads")
      .select("id, author_id, board_categories ( hidden, audience )")
      .eq("id", threadId)
      .maybeSingle();
    const room = thread
      ? ((thread as Record<string, unknown>).board_categories as { hidden: boolean; audience: string } | null)
      : null;
    if (!thread || (room && !canSeeCategory(viewer, room))) {
      return wrap(jsonResponse({ error: "That event is gone." }, 404));
    }
    if (thread.author_id !== viewer.id && !viewer.isModerator) {
      return wrap(jsonResponse({ error: "Only whoever started the event can change it." }, 403));
    }
    const { data: existing } = await supabase
      .from("board_events")
      .select("thread_id")
      .eq("thread_id", threadId)
      .maybeSingle();
    if (!existing) return wrap(jsonResponse({ error: "That topic isn't an event." }, 404));

    // Whose name goes on the post: the person who started it.
    let who = viewer.displayName;
    if (thread.author_id && thread.author_id !== viewer.id) {
      const { namesOf } = await import("../../../src/lib/board-messages.ts");
      who = (await namesOf(supabase, [thread.author_id as string])).get(thread.author_id as string) ?? who;
    }

    const { error: evError } = await supabase
      .from("board_events")
      .update({
        hosting: e.hosting,
        event_date: e.date,
        start_time: e.start,
        end_time: e.end,
        place: e.place,
        address: e.address || null,
        contact: e.contact || null,
        gift: e.gift,
      })
      .eq("thread_id", threadId);
    if (evError) return wrap(jsonResponse({ error: evError.message }, 500));

    await supabase.from("board_threads").update({ title: e.title }).eq("id", threadId);

    // The first post is written again from the fields; what it said before
    // is kept for the moderators' edit history.
    const { data: first } = await supabase
      .from("board_posts")
      .select("id, body")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (first) {
      const body = eventBody(e, who);
      if (body !== first.body) {
        await supabase.from("board_post_edits").insert({ post_id: first.id, body: first.body, edited_by: viewer.id });
        await supabase
          .from("board_posts")
          .update({ body, edited_at: new Date().toISOString() })
          .eq("id", first.id);
      }
    }

    // The "please bring" list: keep, rename, add, and drop.
    const { data: current } = await supabase
      .from("board_event_items")
      .select("id")
      .eq("thread_id", threadId);
    const keep = new Set(e.items.map((i) => i.id).filter(Boolean) as string[]);
    const drop = (current ?? []).map((r) => r.id as string).filter((id) => !keep.has(id));
    if (drop.length) await supabase.from("board_event_items").delete().in("id", drop);
    for (let position = 0; position < e.items.length; position++) {
      const item = e.items[position];
      if (item.id && (current ?? []).some((r) => r.id === item.id)) {
        await supabase.from("board_event_items").update({ label: item.label, position }).eq("id", item.id);
      } else {
        await supabase.from("board_event_items").insert({ thread_id: threadId, label: item.label, position });
      }
    }

    if (viewer.isModerator && thread.author_id !== viewer.id) {
      await logAction(supabase, viewer.id, "Edited an event", `"${e.title}"`);
    }
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
