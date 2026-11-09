-- =============================================================
-- Whether a request may be printed.
--
-- The form asks. Some people want the parish praying for them and do
-- not want their mother's illness in a newsletter that gets a page on
-- the website, and those are two different things to agree to.
--
-- Defaults true, because that is what the form offers by default and
-- what every request sent before this column existed was understood
-- to mean.
-- =============================================================

alter table public.prayer_requests
  add column if not exists in_newsletter boolean not null default true;
