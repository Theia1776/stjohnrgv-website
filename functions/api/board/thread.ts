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
import {
  attachPhotos,
  photoUrl,
  purgePhotos,
  postIdsInThreads,
} from "../../../src/lib/board-photos.ts";

const MAX_BODY = 10000;
const MAX_TITLE = 160;
const GONE = "A former parishioner";

/** What sits under a name in the author column, the way a forum shows a rank. */
function rankOf(role: string | null): string {
  switch (role) {
    case "admin":
      return "Parish Admin";
    case "member":
      return "Member";
    case "catechumen":
      return "Catechumen";
    default:
      return "Inquirer";
  }
}

interface AuthorPanel {
  name: string;
  rank: string;
  joined: string;
  posts: number;
  avatarUrl: string | null;
}

/** The panel shown for somebody whose account is gone. */
const GONE_PANEL: AuthorPanel = {
  name: GONE,
  rank: "",
  joined: "",
  posts: 0,
  avatarUrl: null,
};

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
        "id, title, author_id, pinned, locked, created_at, category_id, view_count, post_count, " +
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

    // Everything the author column down the left of each post shows:
    // who they are, what they are, when they joined, how much they've
    // written here. Counted per author in one query rather than per
    // post, because the same person usually wrote several of them.
    const ids = [...new Set((posts ?? []).map((p) => p.author_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    const panels = new Map<string, AuthorPanel>();
    if (ids.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, role, avatar_url, created_at")
        .in("id", ids);

      const { data: counts } = await supabase
        .from("board_posts")
        .select("author_id")
        .in("author_id", ids);
      const postTally = new Map<string, number>();
      for (const row of counts ?? []) {
        const who = row.author_id as string;
        postTally.set(who, (postTally.get(who) ?? 0) + 1);
      }

      for (const p of profiles ?? []) {
        const id = p.id as string;
        const name = shortName(p.first_name as string | null, p.last_name as string | null);
        names.set(id, name);
        panels.set(id, {
          name,
          rank: rankOf(p.role as string | null),
          joined: p.created_at as string,
          posts: postTally.get(id) ?? 0,
          avatarUrl: (p.avatar_url as string | null) ?? null,
        });
      }
    }

    // Each author's signature, if they've set one. Looked up here, not
    // stored on the post, so editing or clearing it takes effect on
    // everything they've written. A failed lookup just means no
    // signatures this time; it shouldn't take the thread down with it.
    const signatures = new Map<string, string>();
    if (ids.length) {
      const { data: sigRows } = await supabase
        .from("board_signatures")
        .select("user_id, body")
        .in("user_id", ids);
      for (const row of sigRows ?? []) {
        signatures.set(row.user_id as string, row.body as string);
      }
    }

    // Reactions on every post in this thread, folded into counts plus
    // whether this person is one of the people who gave each one.
    const postIds = (posts ?? []).map((p) => p.id as string);
    const reactions = new Map<string, Map<string, { count: number; mine: boolean }>>();
    if (postIds.length) {
      const { data: rows } = await supabase
        .from("board_reactions")
        .select("post_id, user_id, emoji")
        .in("post_id", postIds);
      for (const r of rows ?? []) {
        const key = r.post_id as string;
        let forPost = reactions.get(key);
        if (!forPost) {
          forPost = new Map();
          reactions.set(key, forPost);
        }
        const emoji = r.emoji as string;
        const tally = forPost.get(emoji) ?? { count: 0, mine: false };
        tally.count += 1;
        if (r.user_id === viewer.id) tally.mine = true;
        forPost.set(emoji, tally);
      }
    }

    // The photos on these posts. The files are served through
    // /api/board/photo, which checks the session, so these are plain
    // same-origin addresses rather than signed links that expire.
    const photosByPost = new Map<string, Array<{ id: string; width: number; height: number }>>();
    if (postIds.length) {
      const { data: photoRows } = await supabase
        .from("board_photos")
        .select("id, post_id, width, height")
        .in("post_id", postIds)
        .order("created_at", { ascending: true });
      for (const r of photoRows ?? []) {
        const key = r.post_id as string;
        const list = photosByPost.get(key) ?? [];
        list.push({ id: r.id as string, width: r.width as number, height: r.height as number });
        photosByPost.set(key, list);
      }
    }

    // Opening it counts as a view.
    await supabase.rpc("board_bump_views", { thread: id });

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
            // +1 because the bump above hasn't landed in this row yet.
            viewCount: (thread.view_count ?? 0) + 1,
            replyCount: Math.max(0, (thread.post_count ?? 0) - 1),
            category: category ? { slug: category.slug, name: category.name } : null,
          },
          posts: list.map((p) => {
            const forPost = reactions.get(p.id as string);
            return {
              id: p.id,
              author: p.author_id ? (names.get(p.author_id as string) ?? GONE) : GONE,
              panel: p.author_id ? (panels.get(p.author_id as string) ?? GONE_PANEL) : GONE_PANEL,
              body: p.body,
              photos: (photosByPost.get(p.id as string) ?? []).map((ph) => ({
                id: ph.id,
                width: ph.width,
                height: ph.height,
                thumb: photoUrl(ph.id, "thumb"),
                full: photoUrl(ph.id, "full"),
              })),
              signature: p.author_id ? (signatures.get(p.author_id as string) ?? "") : "",
              createdAt: p.created_at,
              editedAt: p.edited_at,
              mine: p.author_id === viewer.id,
              reactions: forPost
                ? [...forPost.entries()]
                    .map(([emoji, t]) => ({ emoji, count: t.count, mine: t.mine }))
                    .sort((a, b) => b.count - a.count)
                : [],
            };
          }),
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
    let body: { id?: unknown; body?: unknown; photoIds?: unknown };
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

    await attachPhotos(supabase, viewer.id, post.id as string, body.photoIds);

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

    // The photo files first: the rows go by cascade, the files don't.
    await purgePhotos(supabase, context.env.LIBRARY_BUCKET, {
      postIds: await postIdsInThreads(supabase, [id]),
    });

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
