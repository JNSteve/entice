-- 0060: agent_uploads.filename.
-- The app stores a CLEAN display name in attachments.filename while the storage
-- path is sanitised and uuid-prefixed (path
-- "…/<uuid>-G26013_Inspection_Letter_Port_of_Brisbane_Aug_2026.pdf" vs filename
-- "G26013_Inspection Letter_Port of Brisbane_Aug 2026.pdf"), so the display name
-- cannot be derived from the path — it has to be carried explicitly. Without
-- this, chunk-uploaded documents showed the uuid-prefixed path segment in a
-- job's Documents list.
alter table public.agent_uploads add column if not exists filename text;
