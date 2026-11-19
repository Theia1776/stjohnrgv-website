/**
 * Cloudflare Pages Function: /api/board/ignore
 *
 * POST   { userId }    stop hearing from this person
 * DELETE ?userId=      hear from them again
 *
 * Ignoring is not blocking. Their messages still arrive; they sit under
 * "Ignored" in your inbox and never count as new. They aren't told, and
 * nothing else on the board changes. Moderators and admins can't be
 * ignored: if something is wrong between two parishioners, the way
 * through is Father, not silence.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { privilegedIds, UUID } from "../../../src/lib/board-messages.ts";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    let body: { userId?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }
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

  try {
    const userId = new URL(context.request.url).searchParams.get("userId") ?? "";
    if (!UUID.test(userId)) return wrap(jsonResponse({ error: "Who?" }, 400));

    const { error } = await supabase
      .from("board_ignores")
      .delete()
      .eq("user_id", viewer.id)
      .eq("ignored_id", userId);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
