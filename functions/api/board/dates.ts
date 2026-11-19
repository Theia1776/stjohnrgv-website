/**
 * Cloudflare Pages Function: /api/board/dates
 *
 * GET   your own name day, baptism day and birthday (month and day)
 * PUT   { nameDay: {month, day, saint?}, baptism: {month, day}, birthday: {month, day} }
 *       any of the three may be null or left out to clear it
 *
 * All optional. People on the board see them on the front page on the
 * day, and for the week before.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { validDay } from "../../../src/lib/board-celebrations.ts";

type Day = { month: number; day: number } | null;

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  const { data } = await supabase
    .from("board_celebrations")
    .select("*")
    .eq("user_id", viewer.id)
    .maybeSingle();
  const pair = (m: unknown, d: unknown): Day =>
    typeof m === "number" && typeof d === "number" ? { month: m, day: d } : null;
  return wrap(
    jsonResponse(
      {
        nameDay: data ? { ...pair(data.name_day_month, data.name_day_day), saint: data.name_day_saint ?? "" } : null,
        baptism: data ? pair(data.baptism_month, data.baptism_day) : null,
        birthday: data ? pair(data.birthday_month, data.birthday_day) : null,
      },
      200,
    ),
  );
}

export async function onRequestPut(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const body = (await context.request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));

    const read = (v: unknown): Day | "bad" => {
      if (v === null || v === undefined) return null;
      const o = v as { month?: unknown; day?: unknown };
      const month = Number(o.month);
      const day = Number(o.day);
      if (!o.month && !o.day) return null;
      return validDay(month, day) ? { month, day } : "bad";
    };
    const nameDay = read(body.nameDay);
    const baptism = read(body.baptism);
    const birthday = read(body.birthday);
    if (nameDay === "bad" || baptism === "bad" || birthday === "bad") {
      return wrap(jsonResponse({ error: "One of those isn't a real date." }, 400));
    }
    const saintRaw = (body.nameDay as { saint?: unknown } | null | undefined)?.saint;
    const saint = typeof saintRaw === "string" ? saintRaw.trim().slice(0, 60) : "";

    const { error } = await supabase.from("board_celebrations").upsert(
      {
        user_id: viewer.id,
        name_day_month: nameDay?.month ?? null,
        name_day_day: nameDay?.day ?? null,
        name_day_saint: nameDay && saint ? saint : null,
        baptism_month: baptism?.month ?? null,
        baptism_day: baptism?.day ?? null,
        birthday_month: birthday?.month ?? null,
        birthday_day: birthday?.day ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
