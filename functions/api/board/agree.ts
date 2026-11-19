/**
 * Cloudflare Pages Function: POST /api/board/agree
 *
 * { version }   the person agrees to the Parish Board Terms.
 *
 * This is the one board route that answers before the terms have been
 * agreed to (requireBoardAccess lets it through by name).
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { TERMS_VERSION } from "../../../src/lib/board-terms.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const { data } = await supabase
    .from("board_agreements")
    .select("user_id")
    .eq("user_id", viewer.id)
    .eq("version", TERMS_VERSION)
    .maybeSingle();
  return wrap(jsonResponse({ agreed: !!data, version: TERMS_VERSION }, 200));
}

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const body = (await context.request.json().catch(() => ({}))) as { version?: unknown };
    if (body.version !== TERMS_VERSION) {
      return wrap(
        jsonResponse({ error: "The terms have changed. Reload the page and read them again." }, 409),
      );
    }
    const { error } = await supabase
      .from("board_agreements")
      .upsert({ user_id: viewer.id, version: TERMS_VERSION }, { onConflict: "user_id,version" });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
