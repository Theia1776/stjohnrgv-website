/**
 * Cloudflare Pages Function: POST /api/prayer-requests
 *
 * Someone sends a name in to be prayed for. Open to anyone — a
 * parishioner who is not signed in, or somebody reading the
 * newsletter on their phone.
 *
 * There is no GET. Nothing here ever reads a prayer request back out:
 * the only way to see this table is the admin route, which checks the
 * role first. A list of who is ill is not something to leave an
 * endpoint for.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../src/lib/supabase";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const MAX_NAME = 120;
const MAX_NOTE = 1000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server not configured." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const name = clean(body.name, MAX_NAME);
  const kind = body.kind === "departed" ? "departed" : "living";
  if (!name) return jsonResponse({ error: "Please give a name to pray for." }, 400);

  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error } = await supabase.from("prayer_requests").insert({
    kind,
    name,
    requested_by: clean(body.requested_by, MAX_NAME) || null,
    contact: clean(body.contact, MAX_NAME) || null,
    note: clean(body.note, MAX_NOTE) || null,
  });

  if (error) {
    // Say the table is missing plainly, so a migration that hasn't
    // been run reads as that rather than as the form being broken.
    const missing = /prayer_requests/.test(error.message) &&
      /does not exist|schema cache/i.test(error.message);
    return jsonResponse(
      { error: missing ? "The prayer list isn't set up on the server yet." : error.message },
      500,
    );
  }

  // Named back, so it is plain which name went in and for which list.
  return jsonResponse(
    {
      ok: true,
      message:
        `Thank you. ${name} has been added to the ${kind === "departed" ? "memorial" : "prayer"} list ` +
        `and will be prayed for. It goes to the parish office, not onto the website.`,
    },
    201,
  );
}
