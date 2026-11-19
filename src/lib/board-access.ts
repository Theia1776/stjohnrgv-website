/**
 * Who may use the parish board, and the bits every board route needs.
 *
 * The board is for catechumens, members and admins. Inquirers are not
 * in it: an inquirer is someone who signed up five minutes ago and is
 * looking into the faith, and the board carries the parish talking
 * among itself — the catechumen lessons, what people are cooking,
 * who's struggling with what. Same instinct as the directory in
 * functions/api/directory.ts.
 *
 * Every board route goes through requireBoardAccess(). Nothing reads
 * these tables with the anon key; RLS denies that outright (see
 * supabase/migrations/026_parish_board.sql).
 */

import { verifySession, withSessionCookies } from "./session.ts";
import { boardIsOpen, NOT_OPEN_YET } from "./board-reveal.ts";
import { SUPABASE_URL } from "./supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { R2Bucket } from "./board-photos.ts";
import { TERMS_VERSION } from "./board-terms.ts";

export interface BoardEnv {
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Where the picture files live. Same bucket as the library. */
  LIBRARY_BUCKET?: R2Bucket;
}

/** Roles that may read and post on the board. */
const BOARD_ROLES = new Set(["catechumen", "member", "admin"]);

/** What an inquirer is told. Warm, not a wall. */
const INQUIRER_MESSAGE =
  "The parish board is where our catechumens and members talk among " +
  "themselves, so it isn't part of your account yet. The library and the " +
  "lessons are open to you now, and the board opens up when Father " +
  "receives you as a catechumen. You're welcome among us.";

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export interface BoardViewer {
  id: string;
  firstName: string;
  lastName: string;
  /** "Maria G." — what gets shown next to a post. */
  displayName: string;
  role: string;
  isAdmin: boolean;
  /** An admin, or a member the admin has made a moderator. */
  isModerator: boolean;
  /** Set while a moderator has stopped this person posting. */
  suspension: { until: string | null; reason: string | null } | null;
}

export interface BoardGate {
  /** Set when the caller must stop and return this response as-is. */
  error?: Response;
  supabase?: SupabaseClient;
  viewer?: BoardViewer;
  /** Wraps a response so a refreshed session cookie rides along. */
  wrap?: (resp: Response) => Response;
}

/** First name plus a last initial: "Maria G." */
export function shortName(first: string | null, last: string | null): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "A parishioner";
  if (!l) return f;
  if (!f) return l;
  return `${f} ${l[0].toUpperCase()}.`;
}

export async function requireBoardAccess(
  context: { request: Request; env: BoardEnv },
): Promise<BoardGate> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) return { error: wrap(jsonResponse({ error: "Unauthorized" }, 401)), wrap };
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: wrap(jsonResponse({ error: "Server not configured." }, 500)), wrap };
  }

  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role")
    .eq("id", session.user.id)
    .single();

  if (error) return { error: wrap(jsonResponse({ error: error.message }, 500)), wrap };

  const role = profile?.role ?? "inquirer";

  // Moderators are a flag kept on the board, not a role on the account.
  // If the lookup fails the person is simply not one.
  const { data: modRow } = await supabase
    .from("board_moderators")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const isModerator = !!modRow;
  const { data: suspensionRow } = await supabase
    .from("board_suspensions")
    .select("until, reason")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const suspension =
    suspensionRow && (!suspensionRow.until || new Date(suspensionRow.until as string).getTime() > Date.now())
      ? { until: (suspensionRow.until as string | null) ?? null, reason: (suspensionRow.reason as string | null) ?? null }
      : null;
  if (!BOARD_ROLES.has(role)) {
    return { error: wrap(jsonResponse({ error: INQUIRER_MESSAGE }, 403)), wrap };
  }

  // Held back until the newsletter announces it. Admins get in now so
  // the board can be set up before anyone else arrives.
  if (!boardIsOpen() && role !== "admin") {
    return { error: wrap(jsonResponse({ error: NOT_OPEN_YET }, 403)), wrap };
  }

  // Nobody gets in until they've agreed to the current terms. The route
  // that records the agreement is the one way through.
  if (new URL(context.request.url).pathname !== "/api/board/agree") {
    const { data: agreed } = await supabase
      .from("board_agreements")
      .select("user_id")
      .eq("user_id", session.user.id)
      .eq("version", TERMS_VERSION)
      .maybeSingle();
    if (!agreed) {
      return {
        error: wrap(
          jsonResponse(
            { error: "Please agree to the Parish Board Terms first.", terms: true, version: TERMS_VERSION },
            403,
          ),
        ),
        wrap,
      };
    }
  }

  return {
    supabase,
    wrap,
    viewer: {
      id: session.user.id,
      firstName: profile?.first_name ?? "",
      lastName: profile?.last_name ?? "",
      displayName: shortName(profile?.first_name ?? null, profile?.last_name ?? null),
      role,
      isAdmin: role === "admin",
      isModerator: role === "admin" || isModerator,
      suspension: role === "admin" || isModerator ? null : suspension,
    },
  };
}

/**
 * If this person is suspended, the response to send instead of doing
 * what they asked. Every route that writes calls it. Reading is never
 * blocked.
 */
export function suspensionBlock(
  viewer: { suspension: { until: string | null; reason: string | null } | null },
  wrap: (resp: Response) => Response,
): Response | null {
  if (!viewer.suspension) return null;
  const until = viewer.suspension.until
    ? ` until ${new Date(viewer.suspension.until).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Chicago",
      })}`
    : " until a moderator lifts it";
  const why = viewer.suspension.reason ? ` Reason given: ${viewer.suspension.reason}` : "";
  return wrap(
    jsonResponse(
      {
        error:
          `You're suspended from posting${until}. You can still read the board.${why} ` +
          `If you have a question, please speak with a moderator or Father.`,
      },
      403,
    ),
  );
}

/**
 * Whether this person may see a room, and everything in it.
 *
 * A room has an audience: everyone on the board, moderators and
 * admins, or admins alone. Every route that touches a category, a
 * topic, a post or a photo asks this before answering, so a room an
 * account can't see isn't just missing from the menu: asking for it by
 * address gets the same "that's gone" as a room that was never there.
 * A hidden room (the admin's way of taking one off the board without
 * deleting it) is visible to admins only, whatever its audience.
 */
export function canSeeCategory(
  viewer: { isAdmin: boolean; isModerator: boolean },
  category: { hidden?: boolean | null; audience?: string | null },
): boolean {
  if (category.hidden && !viewer.isAdmin) return false;
  switch (category.audience) {
    case "admins":
      return viewer.isAdmin;
    case "moderators":
      return viewer.isModerator;
    default:
      return true;
  }
}

/** A slug for a category name: "The Kitchen" -> "the-kitchen". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
