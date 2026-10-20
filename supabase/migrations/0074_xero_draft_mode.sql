-- Xero send mode: a third option parks each pushed invoice/claim in Xero as a
-- DRAFT for the owner to approve and email from Xero. ECR keeps the record as
-- Draft (locked) until the nightly sync sees it AUTHORISED.
alter table settings drop constraint if exists settings_xero_email_mode_check;
alter table settings
  add constraint settings_xero_email_mode_check
  check (xero_email_mode in ('draft', 'xero', 'ecr'));

-- The owner asked for drafts (2026-10-20).
update settings set xero_email_mode = 'draft' where id = 1;
