-- 0078: crew-facing curation flag on attachments.
--
-- The field job screen's Docs tab lists only job/project documents the office
-- has ticked "Show to crew". This is a DISPLAY filter, not a security
-- boundary: migration 0019 already lets supervisor/field read job and project
-- attachments. No policy changes — attachments_update_admin_office already
-- limits who can flip it.

alter table attachments
  add column field_visible boolean not null default false;

comment on column attachments.field_visible is
  'Office-set: list this job/project document on the field Docs tab.';
