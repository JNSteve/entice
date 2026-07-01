------------------------------------------------------------------------------
-- 0018  Form submission schema snapshots + robust document acknowledgements
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. Snapshot the template schema onto each form submission (FIX I2)
------------------------------------------------------------------------------
-- Historical submissions stored only `template_version`, no schema copy, so
-- editing a template (which overwrites form_templates.schema in place) made
-- old records render against the wrong field set. Capture the schema at submit
-- time. Existing rows are backfilled best-effort from the template's CURRENT
-- schema — we cannot recover the true historical schema, but this freezes
-- today's state and stops future drift.

alter table form_submissions
  add column if not exists schema_snapshot jsonb;

update form_submissions s
   set schema_snapshot = t.schema
  from form_templates t
 where t.id = s.template_id
   and s.schema_snapshot is null;

------------------------------------------------------------------------------
-- 2. Make document acknowledgement matching robust (FIX I6 + SEC2)
------------------------------------------------------------------------------
-- Acks were matched by a recomputed chain ordinal (document_id, user_id,
-- version). Deleting a superseded predecessor shifted every successor's ordinal
-- and orphaned ack rows; the ordinal was also client-supplied (spoofable).
--
-- Each issued version is already its own documents row with its own id, and
-- document_acknowledgements.document_id points at that exact row — so the row
-- identity alone is a stable, un-spoofable key. Match acks by document_id only.
-- `version` becomes an informational (nullable) column, derived server-side.

-- One ack per user per issued document ROW (document_id pins the version).
alter table document_acknowledgements
  drop constraint if exists document_acknowledgements_document_id_user_id_version_key;

alter table document_acknowledgements
  alter column version drop not null;

-- Guard against duplicate acks now that version no longer participates in the key.
create unique index if not exists document_acknowledgements_document_user_key
  on document_acknowledgements (document_id, user_id);
