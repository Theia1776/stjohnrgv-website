/**
 * @mentions on the server.
 *
 * A mention is the text "@Maria G." in a post. The names are the same
 * ones the board shows next to posts: first name and last initial, or
 * the full last name when two people would otherwise look alike.
 * Working it out from the text, rather than storing ids inside it,
 * keeps the box readable while someone types.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { shortName } from "./board-access.ts";

/** id -> the name used to mention that person. Everyone who can use the board. */
export async function mentionLabels(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("role", ["catechumen", "member", "admin"]);

  const rows = (data ?? []).map((p) => ({
    id: p.id as string,
    first: ((p.first_name as string | null) ?? "").trim(),
    last: ((p.last_name as string | null) ?? "").trim(),
    name: shortName(p.first_name as string | null, p.last_name as string | null),
  }));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);

  const labels = new Map<string, string>();
  for (const r of rows) {
    labels.set(
      r.id,
      (counts.get(r.name) ?? 0) > 1 && r.last ? `${r.first} ${r.last}`.trim() : r.name,
    );
  }
  return labels;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Does the text tag this name? "@Maria G." counts; "email@Maria" does not. */
export function mentions(text: string, label: string): boolean {
  const needle = `@${label}`.toLowerCase();
  const hay = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : hay[at - 1];
    const after = hay[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/**
 * Note who a post tags. Only in rooms open to the whole board: a
 * private room's posts don't send anyone a pointer they might not be
 * able to follow. Never fails the post.
 */
export async function recordMentions(
  supabase: SupabaseClient,
  postId: string,
  authorId: string,
  text: string,
): Promise<void> {
  try {
    if (!text.includes("@")) return;

    const { data: post } = await supabase
      .from("board_posts")
      .select("board_threads ( board_categories ( audience, hidden ) )")
      .eq("id", postId)
      .maybeSingle();
    const room = ((post as Record<string, unknown> | null)?.board_threads as
      | { board_categories: { audience: string; hidden: boolean } | null }
      | null)?.board_categories;
    if (!room || room.audience !== "members" || room.hidden) return;

    const labels = await mentionLabels(supabase);
    const tagged = [...labels.entries()]
      .filter(([id, label]) => id !== authorId && mentions(text, label))
      .map(([id]) => id);
    if (!tagged.length) return;

    await supabase
      .from("board_mentions")
      .upsert(
        tagged.map((user_id) => ({ user_id, post_id: postId, by_id: authorId })),
        { onConflict: "user_id,post_id", ignoreDuplicates: true },
      );
  } catch {
    // A mention that doesn't record shouldn't lose someone their post.
  }
}
