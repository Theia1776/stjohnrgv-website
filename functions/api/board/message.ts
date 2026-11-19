/**
 * Cloudflare Pages Function: /api/board/message
 *
 * GET    ?id=                        one conversation, with its messages
 *                                    (and marks it read for you)
 * POST   { to, subject, body }       start a conversation with one person
 * POST   { id, body }                reply in a conversation you are in
 * DELETE ?id=                        take it out of your inbox
 *
 * A conversation is private to the people in it. The only way in is a
 * member row, with one exception: a Help request is open to every
 * moderator and admin, because that is who it was sent to, including
 * ones appointed after it was sent.
 *
 * Removing a conversation only clears it from your inbox. If the other
 * person writes again it comes back as new. The last person to remove
 * it takes it off the server.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import {
  MAX_BODY,
  MAX_SUBJECT,
  UUID,
  GONE,
  namesOf,
  otherParty,
  privilegedIds,
  overHourlyLimit,
  postMessage,
  withoutThoseIgnoring,
  openFor,
} from "../../../src/lib/board-messages.ts";

const BOARD_ROLES = ["catechumen", "member", "admin"];

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const id = new URL(context.request.url).searchParams.get("id") ?? "";
    const conv = await openFor(supabase, viewer, id);
    if (!conv) return wrap(jsonResponse({ error: "That conversation is gone." }, 404));

    const { data: messages, error } = await supabase
      .from("board_messages")
      .select("id, author_id, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    // Opening it reads it.
    await supabase
      .from("board_conversation_members")
      .upsert(
        { conversation_id: id, user_id: viewer.id, last_read_at: new Date().toISOString() },
        { onConflict: "conversation_id,user_id" },
      );

    const other = conv.kind === "direct" ? otherParty(conv, viewer.id) : null;
    const authorIds = (messages ?? []).map((m) => m.author_id as string | null);
    const names = await namesOf(
      supabase,
      [...new Set([...authorIds, conv.created_by, other].filter(Boolean))] as string[],
    );
    const nameOf = (uid: string | null) => (uid ? (names.get(uid) ?? GONE) : GONE);

    const privileged = other ? await privilegedIds(supabase) : new Set<string>();

    let topic: { id: string; title: string } | null = null;
    if (conv.thread_id) {
      const { data: t } = await supabase
        .from("board_threads")
        .select("id, title")
        .eq("id", conv.thread_id)
        .maybeSingle();
      if (t) topic = { id: t.id as string, title: t.title as string };
    }

    return wrap(
      jsonResponse(
        {
          conversation: {
            id: conv.id,
            kind: conv.kind,
            subject: conv.subject,
            with:
              conv.kind === "help"
                ? conv.created_by === viewer.id
                  ? "The moderators"
                  : nameOf(conv.created_by)
                : nameOf(other),
            startedByYou: conv.created_by === viewer.id,
            topic,
          },
          messages: (messages ?? []).map((m) => ({
            id: m.id,
            author: nameOf(m.author_id as string | null),
            body: m.body,
            createdAt: m.created_at,
            mine: m.author_id === viewer.id,
          })),
          // Only a plain conversation with an ordinary member can be
          // ignored; staff never can.
          person:
            other && !privileged.has(other)
              ? { id: other, name: nameOf(other), ignored: false }
              : null,
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

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    let input: { to?: unknown; subject?: unknown; body?: unknown; id?: unknown };
    try {
      input = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const text = typeof input.body === "string" ? input.body.trim() : "";
    if (!text) return wrap(jsonResponse({ error: "Write something first." }, 400));
    if (text.length > MAX_BODY) {
      return wrap(jsonResponse({ error: `Keep it to ${MAX_BODY} characters or fewer.` }, 400));
    }
    if (await overHourlyLimit(supabase, viewer.id)) {
      return wrap(
        jsonResponse({ error: "That's a lot of messages in an hour. Try again a little later." }, 429),
      );
    }

    // ---- a reply ----
    if (typeof input.id === "string" && input.id) {
      const conv = await openFor(supabase, viewer, input.id);
      if (!conv) return wrap(jsonResponse({ error: "That conversation is gone." }, 404));

      let recipients: string[];
      if (conv.kind === "help") {
        recipients =
          conv.created_by === viewer.id
            ? [...(await privilegedIds(supabase))]
            : conv.created_by
              ? [conv.created_by]
              : [];
      } else {
        const other = otherParty(conv, viewer.id);
        recipients = other ? [other] : [];
      }

      recipients = await withoutThoseIgnoring(supabase, viewer.id, recipients);
      await postMessage(supabase, conv.id, viewer.id, text, recipients);
      return wrap(jsonResponse({ ok: true, id: conv.id }, 200));
    }

    // ---- a new conversation ----
    const to = typeof input.to === "string" ? input.to.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    if (!UUID.test(to)) return wrap(jsonResponse({ error: "Who is it for?" }, 400));
    if (to === viewer.id) return wrap(jsonResponse({ error: "That one is you." }, 400));
    if (!subject) return wrap(jsonResponse({ error: "Give it a subject." }, 400));
    if (subject.length > MAX_SUBJECT) {
      return wrap(jsonResponse({ error: `Keep the subject to ${MAX_SUBJECT} characters or fewer.` }, 400));
    }

    const { data: person } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", to)
      .maybeSingle();
    if (!person || !BOARD_ROLES.includes(person.role as string)) {
      return wrap(jsonResponse({ error: "That person can't get messages on the board." }, 404));
    }

    const { data: made, error: makeError } = await supabase
      .from("board_conversations")
      .insert({ kind: "direct", subject, created_by: viewer.id, recipient_id: to })
      .select("id")
      .single();
    if (makeError) return wrap(jsonResponse({ error: makeError.message }, 500));

    try {
      // If they've ignored you, it's kept for you and never reaches them.
      const deliver = await withoutThoseIgnoring(supabase, viewer.id, [to]);
      await postMessage(supabase, made.id as string, viewer.id, text, deliver);
    } catch (err) {
      await supabase.from("board_conversations").delete().eq("id", made.id);
      throw err;
    }
    return wrap(jsonResponse({ ok: true, id: made.id }, 201));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestDelete(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const id = new URL(context.request.url).searchParams.get("id") ?? "";
    if (!UUID.test(id)) return wrap(jsonResponse({ error: "Which conversation?" }, 400));

    const { data: removed, error } = await supabase
      .from("board_conversation_members")
      .delete()
      .eq("conversation_id", id)
      .eq("user_id", viewer.id)
      .select("user_id");
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    if (!removed?.length) return wrap(jsonResponse({ ok: true }, 200));

    // The last one out takes it off the server.
    const { count } = await supabase
      .from("board_conversation_members")
      .select("user_id", { count: "exact", head: true })
      .eq("conversation_id", id);
    if ((count ?? 0) === 0) {
      await supabase.from("board_conversations").delete().eq("id", id);
    }
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
