-- 0019: tighten attachment read scope (SEC1).
--
-- Both the attachments TABLE select and the 'attachments' storage-bucket
-- select were blanket any-authenticated. Money parents (quote/invoice/claim/
-- po) are never written by field flows today, but scope reads defensively:
--
--   * admin/office        → everything (unchanged)
--   * supervisor/field    → only the operational parent set
--                           (job, project, diary, incident, form_submission,
--                            ncr); vendor/variation/package/quote/invoice/
--                            claim/po rows become office-only.
--
-- Storage mirrors the same split by top-level folder. Field additionally
-- needs 'swms' (signature PNGs rendered into ops PDFs under the requester's
-- JWT) and 'whs-documents' (issued safety documents listed on /field/safety).
-- Insert/delete policies are deliberately untouched (see 0005/0015).

------------------------------------------------------------------------------
-- 1. attachments table: replace the blanket select policy
------------------------------------------------------------------------------

drop policy if exists attachments_select_authenticated on public.attachments;

create policy attachments_select_scoped on public.attachments
  for select to authenticated
  using (
    current_app_role() in ('admin','office')
    or parent_type in (
      'job','project','diary','incident','form_submission','ncr'
    )
  );

------------------------------------------------------------------------------
-- 2. storage 'attachments' bucket: replace the blanket select policy
------------------------------------------------------------------------------

drop policy if exists "attachments_select_authenticated" on storage.objects;

create policy "attachments_select_scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      current_app_role() in ('admin','office')
      or (storage.foldername(name))[1] in (
        'job','project','diary','incident','form_submission','ncr',
        'swms','whs-documents'
      )
    )
  );
