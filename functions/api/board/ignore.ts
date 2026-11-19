/**
 * Cloudflare Pages Function: /api/board/ignore
 *
 * POST   { userId }      ignore this person
 * POST   { askLift }     ask the moderators to lift an ignore (userId)
 * GET                    moderators and admins: every ignore in place
 * DELETE ?userId=&by=    moderators and admins: lift one
 *
 * Ignoring is a real block, and it can't be undone by the person who
 * did it. Their messages are never delivered to you, nothing of theirs
 * shows in your inbox, and they aren't told. Only a moderator or admin
 * can lift it, so nobody can switch someone off and on to play games:
 * either the problem gets worked out, or the ignore stays.
 *
 * Moderators and admins can't be ignored. If something is wrong between
 * two parishioners, the way through is Father, not silence.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import {
  MAX_SUBJECT,
  UUID,
  namesOf,
  overHourlyLimit,
  postMessage,
  privilegedIds,
} from "../../../src/lib/board-messages.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isModerator) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const { data, error } = await supabase
      .from("board_ignores")
      .select("user_id, ignored_id, created_at")
      .order("created_at", { ascending: false });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const ids = [...new Set((data ?? []).flatMap((r) => [r.user_id as string, r.ignored_id as string]))];
    const names = await namesOf(supabase, ids);
    return wrap(
      jsonResponse(
        {
          ignores: (data ?? []).map((r) => ({
            by: r.user_id,
            byName: names.get(r.user_id as string) ?? "A former parishioner",
            ignored: r.ignored_id,
            ignoredName: names.get(r.ignored_id as string) ?? "A former parishioner",
            since: r.created_at,
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

  try {
    let body: { userId?: unknown; askLift?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    // ---- ask the moderators to lift one of your ignores ----
    if (typeof body.askLift === "string") {
      const target = body.askLift.trim();
      if (!UUID.test(target)) return wrap(jsonResponse({ error: "Who?" }, 400));
      const { data: row } = await supabase
        .from("board_ignores")
        .select("ignored_id")
        .eq("user_id", viewer.id)
        .eq("ignored_id", target)
        .maybeSingle();
      if (!row) return wrap(jsonResponse({ error: "You aren't ignoring that person." }, 404));
      if (await overHourlyLimit(supabase, viewer.id)) {
        return wrap(jsonResponse({ error: "Try again a little later." }, 429));
      }

      const names = await namesOf(supabase, [target]);
      const them = names.get(target) ?? "that person";
      const { data: made, error: makeError } = await supabase
        .from("board_conversations")
        .insert({
          kind: "help",
          subject: `Lift ignore: ${them}`.slice(0, MAX_SUBJECT),
          created_by: viewer.id,
        })
        .select("id")
        .single();
      if (makeError) return wrap(jsonResponse({ error: makeError.message }, 500));
      try {
        await postMessage(
          supabase,
          made.id as string,
          viewer.id,
          `I'd like to ask that my ignore of ${them} be lifted.`,
          [...(await privilegedIds(supabase))],
        );
      } catch (err) {
        await supabase.from("board_conversations").delete().eq("id", made.id);
        throw err;
      }
      return wrap(jsonResponse({ ok: true }, 200));
    }

    // ---- ignore someone ----
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!UUID.test(userId)) return wrap(jsonResponse({ error: "Who?" }, 400));
    if (userId === viewer.id) {
      return wrap(jsonResponse({ error: "You can't ignore yourself." }, 400));
    }

    const { data: person } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!person) return wrap(jsonResponse({ error: "That person isn't here anymore." }, 404));

    if ((await privilegedIds(supabase)).has(userId)) {
      return wrap(
        jsonResponse(
          {
            error:
              "Moderators and admins can't be ignored. If something is wrong, the best " +
              "thing is to talk it through with Father.",
          },
          403,
        ),
      );
    }

    const { error } = await supabase
      .from("board_ignores")
      .upsert({ user_id: viewer.id, ignored_id: userId }, { onConflict: "user_id,ignored_id" });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
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
  if (!viewer.isModerator) {
    return wrap(
      jsonResponse({ error: "Only a moderator or admin can lift an ignore." }, 403),
    );
  }

  try {
    const params = new URL(context.request.url).searchParams;
    const userId = params.get("userId") ?? "";
    const by = params.get("by") ?? "";
    if (!UUID.test(userId) || !UUID.test(by)) return wrap(jsonResponse({ error: "Who?" }, 400));

    const { error } = await supabase
      .from("board_ignores")
      .delete()
      .eq("user_id", by)
      .eq("ignored_id", userId);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
