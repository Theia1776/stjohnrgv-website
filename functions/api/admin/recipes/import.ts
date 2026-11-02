/**
 * Cloudflare Pages Function: POST /api/admin/recipes/import
 *
 * Load a batch of recipes prepared off-site — the parish's own
 * collection, read out of the old recipe-card PDFs.
 *
 * Everything arrives as a DRAFT. 314 rows appearing on the site at once
 * without anyone reading them is exactly what the review queue exists
 * to prevent, and an imported recipe deserves the same look as one a
 * parishioner sends in.
 *
 * Idempotent by title and book: re-running after a stop, a crash, or a
 * corrected file costs nothing and creates no duplicates. That matters
 * because the browser sends these a few dozen at a time, and a run that
 * fails halfway must be safe to repeat.
 *
 * Body: { recipes: [{ title, fasting, hands_on?, total_time?, serves?,
 *                     preheat?, intro?, ingredients[], directions[],
 *                     notes?, category? }] }
 * Returns: { added, skipped, failed: [{ title, why }] }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { allCategoryValues } from "../../../../src/lib/recipe-categories";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// A batch the browser sends; it loops until the file is done.
const MAX_PER_REQUEST = 60;
const MAX_INGREDIENTS = 60;
const MAX_DIRECTIONS = 40;
const MAX_FIELD = 400;
const MAX_STEP = 2000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "recipe"
  );
}

function cleanList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((v) => v.slice(0, maxLength));
}

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "";
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (profile?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    let body: { recipes?: unknown } = {};
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const incoming = Array.isArray(body.recipes) ? body.recipes : [];
    if (incoming.length === 0) {
      return wrap(jsonResponse({ error: "No recipes in that batch." }, 400));
    }
    if (incoming.length > MAX_PER_REQUEST) {
      return wrap(
        jsonResponse({ error: `Send at most ${MAX_PER_REQUEST} recipes per request.` }, 400),
      );
    }

    // What is already here, so a repeated run adds nothing twice. Title
    // and book together: the same dish can appear in both books, once as
    // written and once adjusted for fasting.
    const { data: existing, error: listError } = await supabase
      .from("recipes")
      .select("title, fasting, slug");
    if (listError) return wrap(jsonResponse({ error: listError.message }, 500));

    const seen = new Set(
      (existing ?? []).map((r) => `${String(r.title).trim().toLowerCase()}|${r.fasting}`),
    );
    const takenSlugs = new Set((existing ?? []).map((r) => r.slug as string));

    let added = 0;
    let skipped = 0;
    const failed: { title: string; why: string }[] = [];

    for (const raw of incoming) {
      const item = raw as Record<string, unknown>;
      const title = cleanField(item.title);
      const fasting = item.fasting === true;

      if (!title) {
        failed.push({ title: "(untitled)", why: "no title" });
        continue;
      }
      if (seen.has(`${title.toLowerCase()}|${fasting}`)) {
        skipped++;
        continue;
      }

      const ingredients = cleanList(item.ingredients, MAX_INGREDIENTS, MAX_FIELD);
      const directions = cleanList(item.directions, MAX_DIRECTIONS, MAX_STEP);
      if (ingredients.length === 0 || directions.length === 0) {
        failed.push({ title, why: "no ingredients or no directions" });
        continue;
      }

      // The fasting copy of a dish needs its own slug, so it is marked
      // rather than silently suffixed with a random string.
      let slug = slugify(title) + (fasting ? "-fasting" : "");
      if (takenSlugs.has(slug)) slug = `${slug}-${crypto.randomUUID().slice(0, 5)}`;

      const category = cleanField(item.category);
      const { error } = await supabase.from("recipes").insert({
        slug,
        title,
        fasting,
        category: allCategoryValues().includes(category) ? category : null,
        hands_on: cleanField(item.hands_on) || null,
        total_time: cleanField(item.total_time) || null,
        serves: cleanField(item.serves) || null,
        preheat: cleanField(item.preheat) || null,
        intro: typeof item.intro === "string" ? item.intro.trim().slice(0, 1200) || null : null,
        ingredients,
        directions,
        notes: typeof item.notes === "string" ? item.notes.trim().slice(0, 1200) || null : null,
        submitted_by: session.user.id,
        // These came from the parish's own collection rather than from a
        // parishioner, and the sheet should say so.
        submitted_by_name: "the parish collection",
        published: false,
      });
      if (error) {
        failed.push({ title, why: error.message });
        continue;
      }

      seen.add(`${title.toLowerCase()}|${fasting}`);
      takenSlugs.add(slug);
      added++;
    }

    return wrap(jsonResponse({ added, skipped, failed }, 200));
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
