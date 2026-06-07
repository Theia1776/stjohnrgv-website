-- =============================================================
-- Master admin flag.
--
-- The parish site has ordinary admins (role = 'admin') who can manage
-- members from /admin/contacts, plus exactly ONE "master" admin who
-- can never be removed, demoted, or edited by another admin, and who
-- alone may grant or revoke the Admin role.
--
-- This is enforced in code by functions/api/admin/update-contact.ts and
-- functions/api/admin/remove.ts, which read this column. It is a
-- separate flag (not a role value) so all the existing
-- `role = 'admin'` checks across the app keep working unchanged — the
-- master admin is also a normal admin, just with this extra bit set.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.profiles
  add column if not exists is_master_admin boolean not null default false;

-- Designate the master admin by their login email (auth.users is the
-- source of truth for email). Re-running is harmless. If the parish
-- ever transfers ownership, flip this column by hand in the dashboard.
update public.profiles p
set is_master_admin = true
from auth.users u
where p.id = u.id
  and lower(u.email) = 'theiagoodner@proton.me';
