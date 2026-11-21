/**
 * Cloudflare Pages Function: POST /api/board/digest-run
 *
 * Called every 15 minutes by the scheduled job in
 * .github/workflows/board-digest.yml. Finds the members whose digest is
 * due (daily at 7 p.m. Central, weekly on Sunday at 7 p.m.) and emails
 * them. Does a few people per call to stay inside what one request is
 * allowed to do; the job calls again while `remaining` is more than 0.
 *
 * Not signed in like a person: the job proves itself with the token in
 * the X-Digest-Token header, checked against site_settings.digest_token.
 *
 * Returns: { sent, quiet, remaining }
 *   sent       emails that went out this call
 *   remaining  people still due after this call
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { boardIsOpen, EARLY_ACCESS } from "../../../src/lib/board-reveal.ts";
import { canSeeCategory } from "../../../src/lib/board-access.ts";
import { loadInbox } from "../../../src/lib/board-messages.ts";
import { sendEmail } from "../../../src/lib/email.ts";
import { digestEmail, isDue, type DigestTopic } from "../../../src/lib/board-digest.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  RESET_EMAIL_FROM?: string;
}

const PER_CALL = 4;
const MAX_TOPICS = 12;
const BOARD_ROLES = new Set(["catechumen", "member", "admin"]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { env } = context;
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !env.RESET_EMAIL_FROM) {
    return json({ error: "Server not configured." }, 500);
  }
  const supabase = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const given = context.request.headers.get("x-digest-token") ?? "";
    const { data: setting } = await supabase.from("site_settings").select("value").eq("key", "digest_token").maybeSingle();
    if (!given || !setting?.value || !same(given, String(setting.value))) {
      return json({ error: "Not allowed." }, 403);
    }

    const now = new Date();
    const origin = new URL(context.request.url).origin;

    const { data: prefs } = await supabase
      .from("board_digest_prefs")
      .select("user_id, frequency, last_sent_at")
      .neq("frequency", "off")
      .order("last_sent_at", { ascending: true });
    const due = (prefs ?? []).filter((p) => isDue(p.frequency as string, p.last_sent_at as string, now));
    if (!due.length) return json({ sent: 0, quiet: 0, remaining: 0 }, 200);

    const batch = due.slice(0, PER_CALL);
    const ids = batch.map((p) => p.user_id as string);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, first_name, role, approved")
      .in("id", ids);
    const { data: mods } = await supabase.from("board_moderators").select("user_id").in("user_id", ids);
    const modSet = new Set((mods ?? []).map((m) => m.user_id as string));
    const person = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    // Everything posted since the earliest of these people's last digest.
    const since = batch.reduce((min, p) => (p.last_sent_at < min ? (p.last_sent_at as string) : min), batch[0].last_sent_at as string);
    const { data: posts } = await supabase
      .from("board_posts")
      .select(
        "id, thread_id, author_id, created_at, reported_hidden, " +
          "board_threads ( title, board_categories ( slug, name, hidden, audience ) )",
      )
      .gt("created_at", since)
      .eq("reported_hidden", false)
      .order("created_at", { ascending: false })
      .limit(1500);
    const { data: reads } = await supabase
      .from("board_reads")
      .select("user_id, thread_id, last_read_at")
      .in("user_id", ids);
    const readAt = new Map((reads ?? []).map((r) => [`${r.user_id}|${r.thread_id}`, new Date(r.last_read_at as string).getTime()]));

    let sent = 0;
    let quiet = 0;
    for (const pref of batch) {
      const uid = pref.user_id as string;
      const me = person.get(uid);
      const stamp = () =>
        supabase.from("board_digest_prefs").update({ last_sent_at: now.toISOString() }).eq("user_id", uid);

      // Only people who can be on the board right now, with an address.
      const allowed =
        me &&
        me.email &&
        me.approved &&
        BOARD_ROLES.has(me.role as string) &&
        (boardIsOpen() || me.role === "admin" || EARLY_ACCESS.has(uid));
      if (!allowed) {
        await stamp();
        quiet++;
        continue;
      }

      const viewer = { isAdmin: me.role === "admin", isModerator: me.role === "admin" || modSet.has(uid) };
      const mineSince = new Date(pref.last_sent_at as string).getTime();
      const byThread = new Map<string, DigestTopic & { last: number }>();
      for (const p of posts ?? []) {
        const created = new Date(p.created_at as string).getTime();
        if (created <= mineSince || p.author_id === uid) continue;
        const thread = (p as Record<string, unknown>).board_threads as
          | { title: string; board_categories: { slug: string; name: string; hidden: boolean; audience: string } | null }
          | null;
        const room = thread?.board_categories;
        if (!thread || !room || !canSeeCategory(viewer, room)) continue;
        // Already read since it was posted: nothing new to say.
        if ((readAt.get(`${uid}|${p.thread_id}`) ?? 0) >= created) continue;
        const key = p.thread_id as string;
        const entry = byThread.get(key) ?? {
          title: thread.title,
          roomName: room.name,
          roomSlug: room.slug,
          newPosts: 0,
          last: 0,
        };
        entry.newPosts += 1;
        entry.last = Math.max(entry.last, created);
        byThread.set(key, entry);
      }
      const ranked = [...byThread.values()].sort((a, b) => b.newPosts - a.newPosts || b.last - a.last);

      let messages = 0;
      try {
        messages = (await loadInbox(supabase, uid)).unreadCount;
      } catch {
        messages = 0;
      }
      let mentions = 0;
      try {
        const { count } = await supabase
          .from("board_mentions")
          .select("post_id", { count: "exact", head: true })
          .eq("user_id", uid)
          .is("seen_at", null);
        mentions = count ?? 0;
      } catch {
        mentions = 0;
      }

      const mail = digestEmail({
        firstName: String(me.first_name ?? ""),
        frequency: pref.frequency as "daily" | "weekly",
        topics: ranked.slice(0, MAX_TOPICS),
        moreTopics: Math.max(0, ranked.length - MAX_TOPICS),
        messages,
        mentions,
        origin,
      });
      const result = await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.RESET_EMAIL_FROM,
        to: me.email as string,
        replyTo: "parishoffice@stjohnrgv.org",
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      if (result.ok) {
        await stamp();
        sent++;
      } else {
        console.error("Digest email failed:", result.error);
      }
    }

    return json({ sent, quiet, remaining: Math.max(0, due.length - batch.length) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
}
