/**
 * Cloudflare Pages Function: /api/board/review   (admins only)
 *
 * GET                      reports waiting, and the access log
 * GET    ?report=<id>      one report's saved copy (logged)
 * GET    ?person=<id>      conversations that person is in right now
 * POST   { conversationId, reason }   open a live conversation (logged,
 *                                     and a reason is required)
 * PATCH  { report, status }           mark a report reviewed or open
 * DELETE ?report=<id>                 remove a report once it's dealt with
 *
 * This is for emergencies, not browsing. Every time an admin opens
 * anything, a row goes in the log with who, when and why, and the log
 * is shown to every admin. Only conversations still on the server can
 * be looked up by person; a conversation everyone has cleared is gone,
 * unless someone reported it, in which case the saved copy remains.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { GONE, UUID, namesOf } from "../../../src/lib/board-messages.ts";

const MIN_REASON = 10;

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const params = new URL(context.request.url).searchParams;
    const reportId = params.get("report");
    const personId = params.get("person");

    // ---- one report ----
    if (reportId) {
      if (!UUID.test(reportId)) return wrap(jsonResponse({ error: "Which report?" }, 400));
      const { data: report } = await supabase
        .from("board_reports")
        .select("id, reported_by, reason, subject, snapshot, status, created_at")
        .eq("id", reportId)
        .maybeSingle();
      if (!report) return wrap(jsonResponse({ error: "That report is gone." }, 404));
      await supabase
        .from("board_review_log")
        .insert({ admin_id: viewer.id, kind: "report", report_id: reportId, reason: "Opened a report" });
      const names = await namesOf(supabase, report.reported_by ? [report.reported_by as string] : []);
      return wrap(
        jsonResponse(
          {
            report: {
              ...report,
              reporter: report.reported_by ? (names.get(report.reported_by as string) ?? GONE) : GONE,
            },
          },
          200,
        ),
      );
    }

    // ---- a person's live conversations ----
    if (personId) {
      if (!UUID.test(personId)) return wrap(jsonResponse({ error: "Who?" }, 400));
      const { data: mine } = await supabase
        .from("board_conversation_members")
        .select("conversation_id")
        .eq("user_id", personId);
      const ids = (mine ?? []).map((m) => m.conversation_id as string);
      if (!ids.length) return wrap(jsonResponse({ conversations: [] }, 200));
      const { data: convs } = await supabase
        .from("board_conversations")
        .select("id, kind, created_by, recipient_id, created_at, last_message_at")
        .in("id", ids)
        .order("last_message_at", { ascending: false });
      const people = [
        ...new Set((convs ?? []).flatMap((c) => [c.created_by, c.recipient_id]).filter(Boolean)),
      ] as string[];
      const names = await namesOf(supabase, people);
      const nameOf = (u: string | null) => (u ? (names.get(u) ?? GONE) : GONE);
      // Who and when only. The subject can say a lot, so it stays hidden
      // until the conversation is opened with a reason.
      return wrap(
        jsonResponse(
          {
            conversations: (convs ?? []).map((c) => ({
              id: c.id,
              kind: c.kind,
              between:
                c.kind === "help"
                  ? `${nameOf(c.created_by as string | null)} and the moderators`
                  : `${nameOf(c.created_by as string | null)} and ${nameOf(c.recipient_id as string | null)}`,
              lastAt: c.last_message_at,
            })),
          },
          200,
        ),
      );
    }

    // ---- the overview ----
    const { data: reports } = await supabase
      .from("board_reports")
      .select("id, reported_by, subject, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    const { data: log } = await supabase
      .from("board_review_log")
      .select("admin_id, kind, report_id, conversation_id, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(60);
    const people = [
      ...new Set(
        [
          ...(reports ?? []).map((r) => r.reported_by as string | null),
          ...(log ?? []).map((l) => l.admin_id as string | null),
        ].filter(Boolean),
      ),
    ] as string[];
    const names = await namesOf(supabase, people);
    const nameOf = (u: string | null) => (u ? (names.get(u) ?? GONE) : GONE);

    return wrap(
      jsonResponse(
        {
          reports: (reports ?? []).map((r) => ({
            id: r.id,
            reporter: nameOf(r.reported_by as string | null),
            subject: r.subject,
            status: r.status,
            at: r.created_at,
          })),
          log: (log ?? []).map((l) => ({
            admin: nameOf(l.admin_id as string | null),
            kind: l.kind,
            reason: l.reason,
            at: l.created_at,
          })),
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
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    let body: { conversationId?: unknown; reason?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }
    const id = typeof body.conversationId === "string" ? body.conversationId : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!UUID.test(id)) return wrap(jsonResponse({ error: "Which conversation?" }, 400));
    if (reason.length < MIN_REASON) {
      return wrap(
        jsonResponse({ error: "Say why you're opening it, in a sentence. It's written to the log." }, 400),
      );
    }

    const { data: conv } = await supabase
      .from("board_conversations")
      .select("id, subject, kind, created_by, recipient_id")
      .eq("id", id)
      .maybeSingle();
    if (!conv) return wrap(jsonResponse({ error: "That conversation is gone." }, 404));

    const { data: messages } = await supabase
      .from("board_messages")
      .select("author_id, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    const { error: logError } = await supabase.from("board_review_log").insert({
      admin_id: viewer.id,
      kind: "conversation",
      conversation_id: id,
      reason: reason.slice(0, 1000),
    });
    // If it can't be logged it isn't opened.
    if (logError) return wrap(jsonResponse({ error: logError.message }, 500));

    const names = await namesOf(
      supabase,
      [...new Set((messages ?? []).map((m) => m.author_id as string | null).filter(Boolean))] as string[],
    );
    return wrap(
      jsonResponse(
        {
          subject: conv.subject,
          messages: (messages ?? []).map((m) => ({
            author: m.author_id ? (names.get(m.author_id as string) ?? GONE) : GONE,
            body: m.body,
            at: m.created_at,
          })),
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

export async function onRequestPatch(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      report?: unknown;
      status?: unknown;
    };
    const id = typeof body.report === "string" ? body.report : "";
    if (!UUID.test(id) || (body.status !== "open" && body.status !== "reviewed")) {
      return wrap(jsonResponse({ error: "Which report, and what status?" }, 400));
    }
    const { error } = await supabase.from("board_reports").update({ status: body.status }).eq("id", id);
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
    const id = new URL(context.request.url).searchParams.get("report") ?? "";
    if (!UUID.test(id)) return wrap(jsonResponse({ error: "Which report?" }, 400));
    const { error } = await supabase.from("board_reports").delete().eq("id", id);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
