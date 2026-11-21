-- =============================================================
-- A board attachment can point at a file that already lives in
-- storage somewhere else (a catechumen lesson PDF), instead of being
-- a copy. When storage_key is set, the board serves that file and
-- never deletes it. This is how the lessons appear in Sunday School
-- without taking up the storage twice.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================
alter table public.board_files add column if not exists storage_key text;
