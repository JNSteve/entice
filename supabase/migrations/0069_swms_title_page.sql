-- SWMS title page: client / job / site / contact snapshot taken at issue, so an
-- issued (signed) SWMS never changes when client or site records are edited.
-- Null on rows issued before this and on uploaded-PDF SWMS.
alter table swms_instances add column title_page jsonb;
