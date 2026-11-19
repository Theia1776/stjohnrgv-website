/**
 * Cloudflare Pages Function: /api/board/moderators   (admins only)
 *
 * GET                  who the moderators are, and who could be made one
 * POST   { userId }    make a catechumen or member a moderator
 * DELETE ?userId=      take it away again
 *
 * A moderator is a flag on the board, not a role on the account: they
 * stay an ordinary member everywhere else on the site. On the board
 * they can pin, close, move and remove topics, remove other people's
 * posts and photos, and see the Moderation Forum. They cannot manage
 * the rooms themselves, see the Admin Forum, or appoint anyone. Admins
 * are moderators already and never appear in this list.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fullName(first: unknown, last: unknown): string {
  const name = `${(first as string) ?? ""} ${(last as string) ?? ""}`.trim();
  return name || "(no name)";
}

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const { data: modRows, error: modError } = await supabase
      .from("board_moderators")
      .select("user_id");
    if (modError) return wrap(jsonResponse({ error: modError.message }, 500));
    const modIds = new Set((modRows ?? []).map((r) => r.user_id as string));

    // Everybody who could hold the job: people already on the board
    // who aren't admins (admins already have every power).
    const { data: people, error: peopleError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, role")
      .in("role", ["catechumen", "member"])
      .order("first_name", { ascending: true });
    if (peopleError) return wrap(jsonResponse({ error: peopleError.message }, 500));

    const moderators: Array<{ id: string; name: string }> = [];
    const candidates: Array<{ id: string; name: string; role: string }> = [];
    for (const p of people ?? []) {
      const id = p.id as string;
      const name = fullName(p.first_name, p.last_name);
      if (modIds.has(id)) moderators.push({ id, name });
      else candidates.push({ id, name, role: p.role as string });
    }

    return wrap(jsonResponse({ moderators, candidates }, 200));
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
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    let body: { userId?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!UUID.test(userId)) return wrap(jsonResponse({ error: "Who?" }, 400));

    const { data: person } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();
    if (!person) return wrap(jsonResponse({ error: "No such person." }, 404));
    if (person.role !== "catechumen" && person.role !== "member") {
      return wrap(
        jsonResponse(
          { error: "Only catechumens and members can be moderators. Admins already are." },
          400,
        ),
      );
    }

    const { error } = await supabase
      .from("board_moderators")
      .upsert({ user_id: userId, added_by: viewer.id }, { onConflict: "user_id" });
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
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const userId = new URL(context.request.url).searchParams.get("userId")?.trim() ?? "";
    if (!UUID.test(userId)) return wrap(jsonResponse({ error: "Who?" }, 400));

    const { error } = await supabase.from("board_moderators").delete().eq("user_id", userId);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
