/**
 * The moderator log: one line for each thing a moderator or admin does
 * that changes the board. Writing to it never gets in the way of the
 * action itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function logAction(
  supabase: SupabaseClient,
  actorId: string,
  action: string,
  detail: string,
  targetId?: string | null,
): Promise<void> {
  try {
    await supabase.from("board_mod_log").insert({
      actor_id: actorId,
      action,
      detail: detail.slice(0, 300),
      target_id: targetId ?? null,
    });
  } catch {
    // The log failing must not undo or block what was just done.
  }
}
