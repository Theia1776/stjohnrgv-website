/**
 * Cloudflare Pages Function: /api/board/suspend   (moderators and admins)
 *
 * GET                       who is suspended right now
 * POST   { userId, days, reason? }   days: 1, 7, 30, or 0 for "until lifted"
 * DELETE ?userId=           lift it
 *
 * A suspended member can still read the board but can't post, reply,
 * react, send messages or upload photos. A timed suspension ends by
 * itself. Admins and moderators can't be suspended; take the moderator
 * flag away first if it ever comes to that.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { logAction } from "../../../src/lib/board-modlog.ts";
import { UUID, namesOf, privilegedIds } from "../../../src/lib/board-messages.ts";

const DAY = 24 * 60 * 60 * 1000;

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isModerator) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const { data, error } = await supabase
      .from("board_suspensions")
      .select("user_id, until, reason, created_at");
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    const now = Date.now();
    const active = (data ?? []).filter((r) => !r.until || new Date(r.until as string).getTime() > now);
    const names = await namesOf(supabase, active.map((r) => r.user_id as string));
    return wrap(
      jsonResponse(
        {
          suspended: active.map((r) => ({
            id: r.user_id,
            name: names.get(r.user_id as string) ?? "A former parishioner",
            until: r.until,
            reason: r.reason,
          })),
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
  if (!viewer.isModerator) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      userId?: unknown;
      days?: unknown;
      reason?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId : "";
    const days = typeof body.days === "number" ? body.days : -1;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (!UUID.test(userId)) return wrap(jsonResponse({ error: "Who?" }, 400));
    if (![0, 1, 7, 30].includes(days)) {
      return wrap(jsonResponse({ error: "How long? One day, a week, a month, or until lifted." }, 400));
    }
    if (userId === viewer.id) return wrap(jsonResponse({ error: "That one is you." }, 400));
    if ((await privilegedIds(supabase)).has(userId)) {
      return wrap(jsonResponse({ error: "Moderators and admins can't be suspended." }, 403));
    }
    const { data: person } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (!person) return wrap(jsonResponse({ error: "That person isn't here anymore." }, 404));

    const until = days === 0 ? null : new Date(Date.now() + days * DAY).toISOString();
    const { error } = await supabase.from("board_suspensions").upsert(
      { user_id: userId, until, reason: reason || null, suspended_by: viewer.id, created_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    await logAction(
      supabase,
      viewer.id,
      "Suspended a member",
      `${days === 0 ? "until lifted" : `${days} day${days === 1 ? "" : "s"}`}${reason ? `. Reason: ${reason}` : ""}`,
      userId,
    );
    return wrap(jsonResponse({ ok: true, until }, 200));
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
  if (!viewer.isModerator) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const userId = new URL(context.request.url).searchParams.get("userId") ?? "";
    if (!UUID.test(userId)) return wrap(jsonResponse({ error: "Who?" }, 400));
    const { error } = await supabase.from("board_suspensions").delete().eq("user_id", userId);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    await logAction(supabase, viewer.id, "Lifted a suspension", "", userId);
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
