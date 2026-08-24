-- =============================================================
-- Parish emails — which parish identity the message went out as.
--
-- /admin/email/ lets an admin send either as the parish office or as
-- Fr. Antonios: the choice sets the From name, the From address, the
-- Reply-To, and (on group mail) the visible To. Recording it here means
-- the Recently Sent list can show whose name a message carried, which
-- is not the same question as which admin pressed send — the existing
-- sent_by / sent_by_name columns answer that.
--
-- 'office' | 'priest'. Older rows predate the choice and are left null,
-- which the admin page renders as the office (what they were).
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.parish_emails
  add column if not exists sent_as text;
