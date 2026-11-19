/**
 * Cloudflare Pages Function: /api/board/categories   (admin only)
 *
 * POST   { name, description?, position? }     add a heading
 * PATCH  { slug, name?, description?, position?, hidden? }
 * DELETE ?slug=<slug>                         remove it, threads and all
 *
 * Everyone else reads the categories through GET /api/board. This
 * route is only for arranging them, which is Theia's job, not the
 * parish's.
 */

import {
  requireBoardAccess,
  jsonResponse,
  slugify,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { postIdsInThreads, purgePhotos } from "../../../src/lib/board-photos.ts";

const MAX_NAME = 80;

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    let body: { name?: unknown; description?: unknown; position?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return wrap(jsonResponse({ error: "Give the category a name." }, 400));
    if (name.length > MAX_NAME) {
      return wrap(jsonResponse({ error: `Names top out at ${MAX_NAME} characters.` }, 400));
    }

    const slug = slugify(name);
    if (!slug) {
      return wrap(
        jsonResponse({ error: "That name has no letters or numbers in it to make a link from." }, 400),
      );
    }

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;

    // Default to the end of the list, leaving the usual gap of ten.
    let position = typeof body.position === "number" ? Math.trunc(body.position) : NaN;
    if (!Number.isFinite(position)) {
      const { data: last } = await supabase
        .from("board_categories")
        .select("position")
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      position = ((last?.position as number) ?? 0) + 10;
    }

    const { error } = await supabase
      .from("board_categories")
      .insert({ slug, name, description, position });
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        return wrap(jsonResponse({ error: "There's already a category with that name." }, 409));
      }
      return wrap(jsonResponse({ error: error.message }, 500));
    }

    return wrap(jsonResponse({ slug }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestPatch(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    let body: {
      slug?: unknown;
      name?: unknown;
      description?: unknown;
      position?: unknown;
      hidden?: unknown;
    };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!slug) return wrap(jsonResponse({ error: "Which category?" }, 400));

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return wrap(jsonResponse({ error: "A category needs a name." }, 400));
      if (name.length > MAX_NAME) {
        return wrap(jsonResponse({ error: `Names top out at ${MAX_NAME} characters.` }, 400));
      }
      // The slug stays as it is. Links people have already shared keep
      // working even after the heading is reworded.
      updates.name = name;
    }
    if (typeof body.description === "string") {
      updates.description = body.description.trim() || null;
    }
    if (typeof body.position === "number" && Number.isFinite(body.position)) {
      updates.position = Math.trunc(body.position);
    }
    if (typeof body.hidden === "boolean") updates.hidden = body.hidden;

    if (!Object.keys(updates).length) {
      return wrap(jsonResponse({ error: "Nothing to change." }, 400));
    }

    const { error } = await supabase.from("board_categories").update(updates).eq("slug", slug);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestDelete(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const url = new URL(context.request.url);
    const slug = url.searchParams.get("slug")?.trim() ?? "";
    if (!slug) return wrap(jsonResponse({ error: "Which category?" }, 400));
    // The Moderation Forum is where close requests are sent; the Admin
    // Forum is the admins' own. Neither is something to delete by accident.
    if (slug === "moderation" || slug === "admin") {
      return wrap(
        jsonResponse(
          { error: "That room is built in and can't be deleted. You can hide it instead." },
          400,
        ),
      );
    }

    const { data: category } = await supabase
      .from("board_categories")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!category) return wrap(jsonResponse({ ok: true }, 200));

    // How much writing is about to go. The caller has to say it knows.
    const { count } = await supabase
      .from("board_threads")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id);

    if ((count ?? 0) > 0 && url.searchParams.get("confirm") !== "yes") {
      return wrap(
        jsonResponse(
          {
            error:
              `That category still holds ${count} thread${count === 1 ? "" : "s"}, and ` +
              `deleting it deletes them and every reply in them. Hide it instead if you ` +
              `just want it off the board.`,
            threadCount: count,
          },
          409,
        ),
      );
    }

    // Photo files first: the rows cascade away with the posts, the
    // files in R2 don't.
    const { data: threadRows } = await supabase
      .from("board_threads")
      .select("id")
      .eq("category_id", category.id);
    await purgePhotos(supabase, context.env.LIBRARY_BUCKET, {
      postIds: await postIdsInThreads(
        supabase,
        (threadRows ?? []).map((t) => t.id as string),
      ),
    });

    const { error } = await supabase.from("board_categories").delete().eq("id", category.id);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
