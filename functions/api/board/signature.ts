/**
 * Cloudflare Pages Function: /api/board/signature
 *
 * GET           your signature ("" if you haven't set one)
 * PUT { body }  set it; an empty body clears it
 *
 * Shown under every post you write, looked up when a thread is
 * displayed rather than copied into each post, so changing it here
 * changes it everywhere and clearing it removes it everywhere.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
  suspensionBlock,
} from "../../../src/lib/board-access.ts";

const MAX_SIGNATURE = 300;
const MAX_LINES = 4;

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { data, error } = await supabase
      .from("board_signatures")
      .select("body")
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ signature: (data?.body as string | undefined) ?? "" }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestPut(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    let payload: { body?: unknown };
    try {
      payload = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }
    if (typeof payload.body !== "string") {
      return wrap(jsonResponse({ error: "What should the signature say?" }, 400));
    }

    // Tidy the edges and cap the height: a few lines is a signature, a
    // wall of blank lines is a billboard.
    const text = payload.body.replace(/\r\n/g, "\n").trim();

    if (text.length > MAX_SIGNATURE) {
      return wrap(
        jsonResponse({ error: `Signatures top out at ${MAX_SIGNATURE} characters.` }, 400),
      );
    }
    if (text.split("\n").length > MAX_LINES) {
      return wrap(jsonResponse({ error: `Signatures top out at ${MAX_LINES} lines.` }, 400));
    }

    if (!text) {
      const { error } = await supabase
        .from("board_signatures")
        .delete()
        .eq("user_id", viewer.id);
      if (error) return wrap(jsonResponse({ error: error.message }, 500));
      return wrap(jsonResponse({ signature: "" }, 200));
    }

    const { error } = await supabase
      .from("board_signatures")
      .upsert(
        { user_id: viewer.id, body: text, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ signature: text }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
