/**
 * What the private-message routes share.
 *
 * Who may see a conversation is decided here and in message.ts, and
 * nowhere in the browser: a person is "in" a conversation if they have
 * a member row, or if it's a Help request and they're a moderator or
 * admin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { shortName, type BoardViewer } from "./board-access.ts";

export const MAX_BODY = 5000;
export const MAX_SUBJECT = 160;
/** Messages one person may send in an hour. Plenty for a person; stops a flood. */
export const MAX_PER_HOUR = 40;
export const GONE = "A former parishioner";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admins and moderators: the people who get Help and can't be ignored. */
export async function privilegedIds(supabase: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data: admins } = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const a of admins ?? []) ids.add(a.id as string);
  const { data: mods } = await supabase.from("board_moderators").select("user_id");
  for (const m of mods ?? []) ids.add(m.user_id as string);
  return ids;
}

export async function ignoredBy(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("board_ignores").select("ignored_id").eq("user_id", userId);
  return new Set((data ?? []).map((r) => r.ignored_id as string));
}

/** id -> "Maria G." for a set of people. */
export async function namesOf(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", ids);
  for (const p of data ?? []) {
    names.set(
      p.id as string,
      shortName(p.first_name as string | null, p.last_name as string | null),
    );
  }
  return names;
}

export interface ConversationRow {
  id: string;
  kind: "direct" | "help";
  subject: string;
  created_by: string | null;
  recipient_id: string | null;
  thread_id: string | null;
  created_at: string;
  last_message_at: string;
  last_author_id: string | null;
}

export const CONVERSATION_COLUMNS =
  "id, kind, subject, created_by, recipient_id, thread_id, created_at, last_message_at, last_author_id";

/** The person on the other end of a direct conversation. */
export function otherParty(c: ConversationRow, viewerId: string): string | null {
  return c.created_by === viewerId ? c.recipient_id : c.created_by;
}

/** Is this conversation one the viewer has chosen to ignore? */
export function isIgnored(
  c: ConversationRow,
  viewerId: string,
  ignoring: Set<string>,
  privileged: Set<string>,
): boolean {
  if (c.kind !== "direct") return false;
  const other = otherParty(c, viewerId);
  return !!other && ignoring.has(other) && !privileged.has(other);
}

export function isUnread(lastMessageAt: string, lastReadAt: string | null): boolean {
  if (!lastReadAt) return true;
  return new Date(lastMessageAt).getTime() > new Date(lastReadAt).getTime();
}

export interface InboxRow {
  id: string;
  kind: "direct" | "help";
  subject: string;
  with: string;
  lastAt: string;
  lastBy: string;
  unread: boolean;
}

/**
 * The viewer's inbox, newest first. A conversation with someone they
 * ignore is left out entirely: ignoring is a block, not a folder.
 */
export async function loadInbox(
  supabase: SupabaseClient,
  viewerId: string,
): Promise<{ rows: InboxRow[]; unreadCount: number; ignoring: Set<string> }> {
  const ignoring = await ignoredBy(supabase, viewerId);

  const { data: mine, error } = await supabase
    .from("board_conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", viewerId);
  if (error) throw new Error(error.message);
  if (!mine?.length) return { rows: [], unreadCount: 0, ignoring };

  const readAt = new Map(
    mine.map((m) => [m.conversation_id as string, m.last_read_at as string | null]),
  );
  const { data: convs, error: convError } = await supabase
    .from("board_conversations")
    .select(CONVERSATION_COLUMNS)
    .in("id", [...readAt.keys()]);
  if (convError) throw new Error(convError.message);

  const list = (convs ?? []) as ConversationRow[];
  const privileged = await privilegedIds(supabase);
  const people = new Set<string>();
  for (const c of list) {
    if (c.created_by) people.add(c.created_by);
    if (c.recipient_id) people.add(c.recipient_id);
    if (c.last_author_id) people.add(c.last_author_id);
  }
  const names = await namesOf(supabase, [...people]);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? GONE) : GONE);

  let unreadCount = 0;
  const rows = list
    .filter((c) => !isIgnored(c, viewerId, ignoring, privileged))
    .map((c): InboxRow => {
      const unread = isUnread(c.last_message_at, readAt.get(c.id) ?? null);
      if (unread) unreadCount += 1;
      // A Help request reads as "the moderators" to the person who sent
      // it, and as the person's name to a moderator.
      const who =
        c.kind === "help"
          ? c.created_by === viewerId
            ? "The moderators"
            : nameOf(c.created_by)
          : nameOf(otherParty(c, viewerId));
      return {
        id: c.id,
        kind: c.kind,
        subject: c.subject,
        with: who,
        lastAt: c.last_message_at,
        lastBy: c.last_author_id === viewerId ? "you" : nameOf(c.last_author_id),
        unread,
      };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

  return { rows, unreadCount, ignoring };
}

/** Put people in a conversation's inbox if they aren't already there. */
export async function addMembers(
  supabase: SupabaseClient,
  conversationId: string,
  userIds: string[],
): Promise<void> {
  if (!userIds.length) return;
  const { data: existing } = await supabase
    .from("board_conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .in("user_id", userIds);
  const have = new Set((existing ?? []).map((r) => r.user_id as string));
  const missing = userIds.filter((id) => !have.has(id));
  if (!missing.length) return;
  const { error } = await supabase
    .from("board_conversation_members")
    .insert(
      missing.map((user_id) => ({ conversation_id: conversationId, user_id, last_read_at: null })),
    );
  if (error) throw new Error(error.message);
}

/**
 * Drop recipients who have ignored the sender. The message is kept for
 * the sender, who isn't told; it just never reaches the other person.
 * Moderators and admins can't be ignored, so theirs always arrive.
 */
export async function withoutThoseIgnoring(
  supabase: SupabaseClient,
  senderId: string,
  recipients: string[],
): Promise<string[]> {
  if (!recipients.length) return recipients;
  if ((await privilegedIds(supabase)).has(senderId)) return recipients;
  const { data } = await supabase
    .from("board_ignores")
    .select("user_id")
    .eq("ignored_id", senderId)
    .in("user_id", recipients);
  const blocking = new Set((data ?? []).map((r) => r.user_id as string));
  return recipients.filter((id) => !blocking.has(id));
}

/** Too many in the last hour? */
export async function overHourlyLimit(
  supabase: SupabaseClient,
  authorId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("board_messages")
    .select("id", { count: "exact", head: true })
    .eq("author_id", authorId)
    .gte("created_at", since);
  return (count ?? 0) >= MAX_PER_HOUR;
}

/**
 * Write a message into a conversation and tell the right people.
 *
 * Bumps the conversation, marks it read for the writer, and puts it in
 * the inbox of each recipient who doesn't have it (someone who removed
 * it gets it back when there's something new). Recipients who already
 * have it simply see it as unread, since it's newer than they last read.
 */
export async function postMessage(
  supabase: SupabaseClient,
  conversationId: string,
  authorId: string,
  body: string,
  recipients: string[],
): Promise<void> {
  const now = new Date().toISOString();

  const { error: msgError } = await supabase
    .from("board_messages")
    .insert({ conversation_id: conversationId, author_id: authorId, body, created_at: now });
  if (msgError) throw new Error(msgError.message);

  const { error: convError } = await supabase
    .from("board_conversations")
    .update({ last_message_at: now, last_author_id: authorId })
    .eq("id", conversationId);
  if (convError) throw new Error(convError.message);

  // The writer: in the inbox, and read up to now.
  const { error: meError } = await supabase
    .from("board_conversation_members")
    .upsert(
      { conversation_id: conversationId, user_id: authorId, last_read_at: now },
      { onConflict: "conversation_id,user_id" },
    );
  if (meError) throw new Error(meError.message);

  await addMembers(
    supabase,
    conversationId,
    recipients.filter((id) => id !== authorId),
  );
}

/** The conversation, if this person is allowed to see it. */
export async function openFor(
  supabase: SupabaseClient,
  viewer: BoardViewer,
  id: string,
): Promise<ConversationRow | null> {
  if (!UUID.test(id)) return null;
  const { data: conv } = await supabase
    .from("board_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!conv) return null;
  const row = conv as ConversationRow;

  const { data: member } = await supabase
    .from("board_conversation_members")
    .select("user_id")
    .eq("conversation_id", id)
    .eq("user_id", viewer.id)
    .maybeSingle();
  if (row.kind === "help") return member || viewer.isModerator ? row : null;
  if (!member) return null;
  // A conversation with someone you ignore is closed to you.
  if (isIgnored(row, viewer.id, await ignoredBy(supabase, viewer.id), await privilegedIds(supabase))) {
    return null;
  }
  return row;
}
