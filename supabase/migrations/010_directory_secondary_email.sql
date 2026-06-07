-- =============================================================
-- Which email shows in the directory: primary (sign-in) or secondary.
--
-- A member now has two emails on /account: their primary (= sign-in /
-- auth.users email) and an optional secondary (profiles.public_email,
-- added in 009). A checkbox next to each picks which one appears in the
-- parish directory.
--
--   directory_show_email          — is an email shown at all (existing).
--   directory_use_secondary_email — when shown, use the secondary email
--                                   instead of the primary. Defaults to
--                                   false, so existing members keep
--                                   showing their primary email exactly
--                                   as before.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.profiles
  add column if not exists directory_use_secondary_email boolean not null default false;
