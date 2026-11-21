/**
 * Cloudflare Pages Function: /api/board/digest-pref
 *
 * GET           { frequency: "off" | "daily" | "weekly" | null }
 *               null means they have not been asked yet.
 * PUT { frequency }   set it. Choosing a digest starts the clock now, so
 *               the first email covers only what comes after.
 */

import { requireBoardAccess, jsonResponse, type BoardEnv } from "../../../src/lib/board-access.ts";

const CHOICES = new Set(["off", "daily", "weekly"]);

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  try {
    const { data } = await supabase
      .from("board_digest_prefs")
      .select("frequency")
      .eq("user_id", viewer.id)
      .maybeSingle();
    return wrap(jsonResponse({ frequency: data ? data.frequency : null }, 200));
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500));
  }
}

export async function onRequestPut(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  try {
    const body = (await context.request.json().catch(() => ({}))) as { frequency?: unknown };
    const frequency = typeof body.frequency === "string" ? body.frequency : "";
    if (!CHOICES.has(frequency)) return wrap(jsonResponse({ error: "Pick daily, weekly or off." }, 400));

    const { data: before } = await supabase
      .from("board_digest_prefs")
      .select("frequency")
      .eq("user_id", viewer.id)
      .maybeSingle();

    const row: Record<string, unknown> = {
      user_id: viewer.id,
      frequency,
      updated_at: new Date().toISOString(),
    };
    // Starting (or switching on from off): count from now.
    if (!before || before.frequency === "off") row.last_sent_at = new Date().toISOString();

    const { error } = await supabase.from("board_digest_prefs").upsert(row, { onConflict: "user_id" });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true, frequency }, 200));
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500));
  }
}
