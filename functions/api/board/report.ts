/**
 * Cloudflare Pages Function: POST /api/board/report
 *
 * { id, reason? }   report a private conversation you are in.
 *
 * Saves a copy of the whole conversation as it stands, so what was said
 * survives even if the conversation is cleared afterward, and sends it
 * to the admins' review page. Nobody else can read it. Messages can't be
 * edited or deleted one by one, so what's in the copy is what was sent.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { GONE, namesOf, openFor, overHourlyLimit } from "../../../src/lib/board-messages.ts";

const MAX_REASON = 1000;
const MAX_MESSAGES = 1000;

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
    const id = typeof body.id === "string" ? body.id : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : "";

    const conv = await openFor(supabase, viewer, id);
    if (!conv) return wrap(jsonResponse({ error: "That conversation is gone." }, 404));
    if (await overHourlyLimit(supabase, viewer.id)) {
      return wrap(jsonResponse({ error: "Try again a little later." }, 429));
    }

    const { data: messages, error } = await supabase
      .from("board_messages")
      .select("author_id, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const people = [
      ...new Set(
        [
          conv.created_by,
          conv.recipient_id,
          viewer.id,
          ...(messages ?? []).map((m) => m.author_id as string | null),
        ].filter(Boolean),
      ),
    ] as string[];
    const names = await namesOf(supabase, people);
    const nameOf = (uid: string | null) => (uid ? (names.get(uid) ?? GONE) : GONE);

    const snapshot = {
      kind: conv.kind,
      startedAt: conv.created_at,
      participants: people.map((p) => ({ id: p, name: nameOf(p) })),
      messages: (messages ?? []).map((m) => ({
        authorId: m.author_id,
        author: nameOf(m.author_id as string | null),
        body: m.body,
        at: m.created_at,
      })),
    };

    const { error: saveError } = await supabase.from("board_reports").insert({
      conversation_id: id,
      reported_by: viewer.id,
      reason: reason || null,
      subject: conv.subject,
      snapshot,
    });
    if (saveError) return wrap(jsonResponse({ error: saveError.message }, 500));

    // A short note in the Admin Forum so the admins see it where they
    // already look, and can talk it over. It carries no message text:
    // the conversation itself stays on the Review page, where each
    // opening is logged. If the note can't be written the report is
    // still saved and still shows on the Review page.
    try {
      const { data: room } = await supabase
        .from("board_categories")
        .select("id")
        .eq("slug", "admin")
        .maybeSingle();
      if (room) {
        const origin = new URL(context.request.url).origin;
        const date = new Date().toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "America/Chicago",
        });
        const { data: note } = await supabase
          .from("board_threads")
          .insert({ category_id: room.id, title: `Conversation reported, ${date}`, author_id: viewer.id })
          .select("id")
          .single();
        if (note) {
          await supabase.from("board_posts").insert({
            thread_id: note.id,
            author_id: viewer.id,
            body:
              `${viewer.displayName} reported a private conversation.\n\n` +
              `Read it on the Review page, where each opening is logged:\n${origin}/board/review/\n\n` +
              `Talk it over here if you like. The conversation itself isn't copied into this room.`,
          });
        }
      }
    } catch {
      // The Review page still has it.
    }

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
