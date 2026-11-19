/**
 * Cloudflare Pages Function: /api/board/thread
 *
 * GET    ?id=<uuid>     one thread and its posts
 * POST   { id, body }   reply to it
 * PATCH  { id, ... }    pin / lock / retitle / move  (admin)
 * DELETE ?id=<uuid>     delete the whole thread      (admin, or your
 *                       own thread while nobody has replied)
 *
 * The GET hands back where this person had got to BEFORE updating
 * their read mark, so the page can draw a line above the posts that
 * are new to them. Then it moves the mark, because they're reading it
 * now.
 */

import {
  requireBoardAccess,
  jsonResponse,
  shortName,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

const MAX_BODY = 10000;
const MAX_TITLE = 160;
const GONE = "A former parishioner";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const id = new URL(context.request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return wrap(jsonResponse({ error: "Which thread?" }, 400));

    const { data: thread, error: threadError } = await supabase
      .from("board_threads")
      .select(
        "id, title, author_id, pinned, locked, created_at, category_id, " +
          "board_categories ( slug, name, hidden )",
      )
      .eq("id", id)
      .maybeSingle();
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));
    if (!thread) return wrap(jsonResponse({ error: "That thread is gone." }, 404));

    const category = (thread as Record<string, unknown>).board_categories as
      | { slug: string; name: string; hidden: boolean }
      | null;
    if (category?.hidden && !viewer.isAdmin) {
      return wrap(jsonResponse({ error: "That thread is gone." }, 404));
    }

    const { data: posts, error: postError } = await supabase
      .from("board_posts")
      .select("id, author_id, body, created_at, edited_at")
      .eq("thread_id", id)
      .order("created_at", { ascending: true });
    if (postError) return wrap(jsonResponse({ error: postError.message }, 500));

    const ids = [...new Set((posts ?? []).map((p) => p.author_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, role, avatar_url")
        .in("id", ids);
      for (const p of profiles ?? []) {
        names.set(
          p.id as string,
          shortName(p.first_name as string | null, p.last_name as string | null),
        );
      }
    }

    // Where they'd got to last time, before we move the marker.
    const { data: readRow } = await supabase
      .from("board_reads")
      .select("last_read_at")
      .eq("user_id", viewer.id)
      .eq("thread_id", id)
      .maybeSingle();
    const previouslyReadAt = (readRow?.last_read_at as string | null) ?? null;

    await supabase
      .from("board_reads")
      .upsert(
        { user_id: viewer.id, thread_id: id, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,thread_id" },
      );

    const list = posts ?? [];
    return wrap(
      jsonResponse(
        {
          thread: {
            id: thread.id,
            title: thread.title,
            pinned: thread.pinned,
            locked: thread.locked,
            createdAt: thread.created_at,
            startedBy: thread.author_id ? (names.get(thread.author_id as string) ?? GONE) : GONE,
            mine: thread.author_id === viewer.id,
            category: category ? { slug: category.slug, name: category.name } : null,
          },
          posts: list.map((p) => ({
            id: p.id,
            author: p.author_id ? (names.get(p.author_id as string) ?? GONE) : GONE,
            body: p.body,
            createdAt: p.created_at,
            editedAt: p.edited_at,
            mine: p.author_id === viewer.id,
          })),
          previouslyReadAt,
          // Only the person who started it, and only while nobody has
          // answered, may remove the whole thread. After that it's a
          // conversation, not a note of theirs to take back.
          canDelete: viewer.isAdmin || (thread.author_id === viewer.id && list.length <= 1),
          viewer: { displayName: viewer.displayName, isAdmin: viewer.isAdmin },
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    let body: { id?: unknown; body?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Which thread?" }, 400));
    if (!text) return wrap(jsonResponse({ error: "Nothing to post." }, 400));
    if (text.length > MAX_BODY) {
      return wrap(jsonResponse({ error: `Posts top out at ${MAX_BODY} characters.` }, 400));
    }

    const { data: thread, error: threadError } = await supabase
      .from("board_threads")
      .select("id, locked, board_categories ( hidden )")
      .eq("id", id)
      .maybeSingle();
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));
    if (!thread) return wrap(jsonResponse({ error: "That thread is gone." }, 404));

    const category = (thread as Record<string, unknown>).board_categories as
      | { hidden: boolean }
      | null;
    if (category?.hidden && !viewer.isAdmin) {
      return wrap(jsonResponse({ error: "That thread is gone." }, 404));
    }
    // A locked thread stays readable; an admin can still add the last word.
    if (thread.locked && !viewer.isAdmin) {
      return wrap(jsonResponse({ error: "This thread is closed to new replies." }, 403));
    }

    const { data: post, error: insertError } = await supabase
      .from("board_posts")
      .insert({ thread_id: id, author_id: viewer.id, body: text })
      .select("id")
      .single();
    if (insertError) return wrap(jsonResponse({ error: insertError.message }, 500));

    await supabase
      .from("board_reads")
      .upsert(
        { user_id: viewer.id, thread_id: id, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,thread_id" },
      );

    return wrap(jsonResponse({ id: post.id }, 200));
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

  try {
    let body: { id?: unknown; pinned?: unknown; locked?: unknown; title?: unknown; category?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Which thread?" }, 400));

    const { data: thread, error: threadError } = await supabase
      .from("board_threads")
      .select("id, author_id")
      .eq("id", id)
      .maybeSingle();
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));
    if (!thread) return wrap(jsonResponse({ error: "That thread is gone." }, 404));

    const updates: Record<string, unknown> = {};

    // Pinning, locking and moving are housekeeping — admins only.
    if (viewer.isAdmin) {
      if (typeof body.pinned === "boolean") updates.pinned = body.pinned;
      if (typeof body.locked === "boolean") updates.locked = body.locked;
      if (typeof body.category === "string" && body.category.trim()) {
        const { data: category } = await supabase
          .from("board_categories")
          .select("id")
          .eq("slug", body.category.trim())
          .maybeSingle();
        if (!category) return wrap(jsonResponse({ error: "No such category." }, 404));
        updates.category_id = category.id;
      }
    }

    // A title can be fixed by whoever wrote it, or by an admin.
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) return wrap(jsonResponse({ error: "A thread needs a title." }, 400));
      if (title.length > MAX_TITLE) {
        return wrap(jsonResponse({ error: `Titles top out at ${MAX_TITLE} characters.` }, 400));
      }
      if (!viewer.isAdmin && thread.author_id !== viewer.id) {
        return wrap(jsonResponse({ error: "That isn't your thread." }, 403));
      }
      updates.title = title;
    }

    if (!Object.keys(updates).length) {
      return wrap(jsonResponse({ error: "Nothing to change." }, 400));
    }

    const { error: updateError } = await supabase
      .from("board_threads")
      .update(updates)
      .eq("id", id);
    if (updateError) return wrap(jsonResponse({ error: updateError.message }, 500));

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

  try {
    const id = new URL(context.request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return wrap(jsonResponse({ error: "Which thread?" }, 400));

    const { data: thread, error: threadError } = await supabase
      .from("board_threads")
      .select("id, author_id, post_count")
      .eq("id", id)
      .maybeSingle();
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));
    if (!thread) return wrap(jsonResponse({ ok: true }, 200));

    const ownAndUnanswered = thread.author_id === viewer.id && (thread.post_count ?? 0) <= 1;
    if (!viewer.isAdmin && !ownAndUnanswered) {
      return wrap(
        jsonResponse(
          { error: "Once somebody has replied, ask an admin to remove the thread." },
          403,
        ),
      );
    }

    // Posts and read marks go with it — both cascade on the thread.
    const { error: deleteError } = await supabase.from("board_threads").delete().eq("id", id);
    if (deleteError) return wrap(jsonResponse({ error: deleteError.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
