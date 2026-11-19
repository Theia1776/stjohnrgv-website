/**
 * Cloudflare Pages Function: POST /api/board/read
 *
 * "Mark all topics read." Moves this person's marker on every thread
 * to now, so the board stops showing bold. The link every forum has
 * had in the corner since forums existed.
 *
 * Optionally takes { category } to mark just one category read.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    // The body is optional here — the bare call means "all of it".
    let slug = "";
    try {
      const body = await context.request.json();
      if (body && typeof body.category === "string") slug = body.category.trim();
    } catch {
      /* no body: mark everything */
    }

    let query = supabase.from("board_threads").select("id");
    if (slug) {
      const { data: category } = await supabase
        .from("board_categories")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!category) return wrap(jsonResponse({ error: "No such category." }, 404));
      query = query.eq("category_id", category.id);
    }

    const { data: threads, error } = await query;
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    if (!threads?.length) return wrap(jsonResponse({ marked: 0 }, 200));

    const now = new Date().toISOString();
    const rows = threads.map((t) => ({
      user_id: viewer.id,
      thread_id: t.id as string,
      last_read_at: now,
    }));

    const { error: upsertError } = await supabase
      .from("board_reads")
      .upsert(rows, { onConflict: "user_id,thread_id" });
    if (upsertError) return wrap(jsonResponse({ error: upsertError.message }, 500));

    return wrap(jsonResponse({ marked: rows.length }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
