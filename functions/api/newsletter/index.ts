/**
 * Cloudflare Pages Function: GET /api/newsletter
 *
 * The published issues, or one of them.
 *
 * Two audiences, decided per issue and enforced here rather than by
 * leaving a link undrawn. A 'public' issue is readable by anyone — the
 * sort that says what the parish is and when the services are. A
 * 'parish' issue is for signed-in accounts, because a newsletter
 * carries names: who is ill, who is travelling, whose child was
 * baptised. That is the default, and the page offers the other
 * deliberately.
 *
 * A direct link to a parish issue is refused for a logged-out visitor,
 * the same as an everyday recipe, so the address is not a way round the
 * rule.
 *
 * Query: ?slug=<slug>   one issue
 *        (none)         the back issues the viewer may see
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** The whole issue, for the page that shows one. */
const FULL_FIELDS =
  "slug, title, issue_label, intro, sections, closing, audience, published_at, written_by_name";

/** Enough for a list of back issues — not every word of every one. */
const LIST_FIELDS = "slug, title, issue_label, intro, audience, published_at";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);
  const signedIn = Boolean(session.user);

  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  const url = new URL(context.request.url);
  const slug = url.searchParams.get("slug")?.trim() ?? "";

  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    if (slug) {
      const { data, error } = await supabase
        .from("newsletters")
        .select(FULL_FIELDS)
        .eq("slug", slug)
        .eq("published", true)
        .maybeSingle();
      if (error) return wrap(jsonResponse({ error: error.message }, 500));
      if (!data) return wrap(jsonResponse({ error: "No such issue." }, 404));

      if (data.audience !== "public" && !signedIn) {
        return wrap(
          jsonResponse(
            {
              error:
                "This issue is for our parish, because it carries our people's " +
                "names and news. Sign in to read it.",
              needs_account: true,
            },
            403,
          ),
        );
      }
      return wrap(jsonResponse({ issue: data, viewer_signed_in: signedIn }, 200));
    }

    let query = supabase
      .from("newsletters")
      .select(LIST_FIELDS)
      .eq("published", true)
      .order("published_at", { ascending: false });

    // Signed out, the parish issues are not listed at all. Listing them
    // as locked rows would advertise that the parish discussed somebody
    // this month, which is the thing being kept in.
    if (!signedIn) query = query.eq("audience", "public");

    const { data, error } = await query;
    // The table doesn't exist until migration 021 is run, and this
    // page is linked from the main navigation. "No issues yet" is both
    // true and the right thing for a visitor to see; a 500 in the top
    // nav is not. Narrow on purpose — any other failure still raises.
    if (error && !/newsletters/.test(error.message ?? "")) {
      return wrap(jsonResponse({ error: error.message }, 500));
    }
    if (error) {
      return wrap(jsonResponse({ issues: [], viewer_signed_in: signedIn, pending: true }, 200));
    }

    return wrap(
      new Response(JSON.stringify({ issues: data ?? [], viewer_signed_in: signedIn }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // Private: what comes back depends on who is asking, and a
          // shared cache would hand one person's answer to the next.
          "Cache-Control": "private, max-age=120",
        },
      }),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
