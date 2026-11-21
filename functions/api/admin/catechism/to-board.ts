/**
 * Cloudflare Pages Function: POST /api/admin/catechism/to-board
 *
 * Body: { authorId, category?, limit? }   (limit: stop after this many, for a trial run)
 *
 * Admin only. Puts every posted catechumen lesson on the Parish Board
 * as its own topic, titled with the lesson's title, in the Sunday School
 * room (or the room named in `category`). The topic is written under the
 * account in `authorId`.
 *
 * The lesson's text goes in the topic so it can be read right there
 * (long ones continue in replies, since a post holds about 10,000
 * characters), and the PDF is attached for printing.
 *
 * The PDF is not copied. The attachment points at the lesson's file
 * where it already sits in storage (board_files.storage_key), so the
 * board adds no storage. Taking the attachment off a post later does
 * not delete the lesson's file.
 *
 * Safe to run twice: a lesson whose title already has a topic in the
 * room is skipped.
 *
 * Returns: { created, skipped, failed: [{ title, why }] }
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  LIBRARY_BUCKET?: { head(key: string): Promise<{ size: number } | null> };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Cut text into pieces a post can hold, at paragraph breaks where it can. */
function chunkText(text: string, max = 9000): string[] {
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  for (let para of text.split(/\n{2,}/)) {
    while (para.length > max) {
      let cut = para.lastIndexOf(". ", max);
      if (cut < max / 2) cut = para.lastIndexOf(" ", max);
      if (cut < 1) cut = max;
      const head = para.slice(0, cut + 1);
      if ((current + "\n\n" + head).length > max) push();
      current += (current ? "\n\n" : "") + head;
      push();
      para = para.slice(cut + 1).trim();
    }
    if (!para) continue;
    if ((current + "\n\n" + para).length > max) push();
    current += (current ? "\n\n" : "") + para;
  }
  push();
  return out;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (r: Response) => withSessionCookies(r, session.refreshedCookies);

  try {
    if (!session.user) return wrap(json({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) return wrap(json({ error: "Server not configured." }, 500));
    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) return wrap(json({ error: "File storage isn't connected." }, 503));

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: me } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
    if (me?.role !== "admin") return wrap(json({ error: "Forbidden" }, 403));

    const body = (await context.request.json().catch(() => ({}))) as { authorId?: unknown; category?: unknown; limit?: unknown };
    const authorId = typeof body.authorId === "string" ? body.authorId : "";
    const slug = typeof body.category === "string" && body.category ? body.category : "scripture-and-the-faith";
    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.floor(body.limit) : Infinity;
    if (!authorId) return wrap(json({ error: "Whose account should these be posted under?" }, 400));

    const { data: author } = await supabase.from("profiles").select("id").eq("id", authorId).maybeSingle();
    if (!author) return wrap(json({ error: "That account doesn't exist." }, 404));

    const { data: room } = await supabase.from("board_categories").select("id").eq("slug", slug).maybeSingle();
    if (!room) return wrap(json({ error: "That room doesn't exist." }, 404));

    const { data: lessons, error: lessonError } = await supabase
      .from("catechism_lessons")
      .select("title, teacher, series, lesson_date, description, pdf_storage_key, text_content, text_status")
      .eq("published", true)
      .order("lesson_date", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    if (lessonError) return wrap(json({ error: lessonError.message }, 500));

    const { data: existing } = await supabase.from("board_threads").select("title").eq("category_id", room.id);
    const have = new Set((existing ?? []).map((t) => String(t.title).trim().toLowerCase()));

    let created = 0;
    let skipped = 0;
    const failed: Array<{ title: string; why: string }> = [];

    for (const l of lessons ?? []) {
      if (created >= limit) break;
      const title = String(l.title).trim().slice(0, 160);
      if (have.has(title.toLowerCase())) {
        skipped++;
        continue;
      }

      const key = String(l.pdf_storage_key ?? "");
      let storageKey = key;
      let found = key ? await bucket.head(key).catch(() => null) : null;
      if (!found && key) {
        // Not in the file bucket: the lesson page falls back to Supabase
        // storage, so the attachment can point there instead ("sb:").
        const { data: blob } = await supabase.storage.from("library").download(key);
        if (blob) {
          found = { size: blob.size };
          storageKey = `sb:${key}`;
        }
      }
      if (!found) {
        failed.push({ title, why: "the PDF isn't in storage" });
        continue;
      }

      const lines: string[] = [];
      if (l.series) lines.push(`[b]Series:[/b] ${l.series}`);
      if (l.teacher) lines.push(`[b]Taught by:[/b] ${l.teacher}`);
      if (l.lesson_date) lines.push(`[b]Date:[/b] ${longDate(l.lesson_date as string)}`);
      const readable =
        l.text_status === "ok" && typeof l.text_content === "string"
          ? l.text_content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uE000\uE001]/g, "").replace(/\u241e\d+\|\d+\u241e\n?/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
          : "";
      const pieces = readable ? chunkText(readable) : [];
      const head =
        (lines.length ? lines.join("\n") + "\n\n" : "") +
        (l.description ? `${String(l.description).trim()}\n\n` : "");
      const text = pieces.length
        ? `${head}${pieces[0]}${pieces.length > 1 ? "\n\n(The lesson continues in the replies below.)" : ""}\n\nThe lesson is also attached below as a PDF, if you would like to print it.`
        : `${head}The lesson is attached below as a PDF.`;

      const { data: thread, error: threadError } = await supabase
        .from("board_threads")
        .insert({ category_id: room.id, title, author_id: authorId })
        .select("id")
        .single();
      if (threadError) {
        failed.push({ title, why: threadError.message });
        continue;
      }

      const { data: post, error: postError } = await supabase
        .from("board_posts")
        .insert({ thread_id: thread.id, author_id: authorId, body: text })
        .select("id")
        .single();
      if (postError) {
        await supabase.from("board_threads").delete().eq("id", thread.id);
        failed.push({ title, why: postError.message });
        continue;
      }

      const { error: fileError } = await supabase.from("board_files").insert({
        post_id: post.id,
        uploader_id: authorId,
        name: `${title}.pdf`.slice(0, 200),
        content_type: "application/pdf",
        bytes: found.size,
        storage_key: storageKey,
      });
      if (fileError) {
        await supabase.from("board_threads").delete().eq("id", thread.id);
        failed.push({ title, why: fileError.message });
        continue;
      }

      // The rest of a long lesson, in order, as replies.
      for (let i = 1; i < pieces.length; i++) {
        const { error: moreError } = await supabase
          .from("board_posts")
          .insert({ thread_id: thread.id, author_id: authorId, body: pieces[i] });
        if (moreError) {
          failed.push({ title, why: `part ${i + 1} didn't post: ${moreError.message}` });
          break;
        }
      }

      have.add(title.toLowerCase());
      created++;
    }

    return wrap(json({ created, skipped, failed }, 200));
  } catch (err) {
    return wrap(json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500));
  }
}
