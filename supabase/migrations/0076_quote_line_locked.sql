-- 0076: quote_lines.locked — per-line "finalised" padlock on the quote builder.
--
-- Why: while a quote is priced, settled lines sit next to lines still being
-- worked on and a stray edit to a finished figure goes unnoticed. A locked
-- line's fields and delete are refused by the server (updateLine/deleteLine)
-- and disabled in the builder; moving it keeps working. Pressing the padlock
-- again unlocks it. Existing lines start unlocked. Duplicating a quote copies
-- each line's lock; lines added from the rate picker or a takeoff start unlocked.

alter table quote_lines
  add column if not exists locked boolean not null default false;

comment on column quote_lines.locked is
  'Finalised: updateLine/deleteLine refuse the line and the builder disables its fields until the padlock is pressed again. Moving it still works.';

insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20261023090000', '0076_quote_line_locked', array['see supabase/migrations/0076_quote_line_locked.sql'])
on conflict (version) do nothing;
