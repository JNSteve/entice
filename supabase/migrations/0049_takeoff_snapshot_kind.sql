-- 0049: plan snapshot on sheets + cost category on quote lines.
-- (Backfilled repo copy — applied to the live DB from a handed paste on
-- 2026-07-12 before this file was committed.)
alter table takeoff_sheets add column snapshot_path text;
alter table quote_lines add column kind text check (kind in ('labour','plant','material','subbie','other'));
