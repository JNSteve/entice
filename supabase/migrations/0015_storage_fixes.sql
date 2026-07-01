-- 0015: storage fixes from the upload-pipeline audit.

-- 1) Owner-delete policy on the attachments bucket, scoped to the
--    {parentType}/{parentId}/ attachment paths.
--
--    The compensating cleanup after a failed attachments-row insert (and
--    deleteAttachment's storage remove) runs with the uploader's JWT. The
--    existing delete policy only covers admin/office, and Supabase Storage
--    reports RLS-filtered deletes as success-with-an-empty-list, so a field
--    user's remove() was a silent no-op — every failed upload+retry orphaned
--    an object, and an owner-deleted attachment row left its object behind.
--    This also aligns storage with the attachments-table delete policy,
--    which already allows created_by = auth.uid().
--
--    Deliberately NOT covered: swms/ (signature PNGs must survive the
--    signer), documents/ and whs-documents/ (controlled register, office
--    manages), public-submissions/ (SWMS register files).
create policy "attachments_delete_own" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = auth.uid()::text
    and (storage.foldername(name))[1] in (
      'job','project','quote','invoice','claim','po','vendor','diary',
      'variation','package','incident','form_submission','ncr'
    )
  );

-- 2) Backfill attachments.size where a server-side flow (subbie-SWMS accept)
--    inserted NULL — the UI renders the size and the accept flow now records
--    it for new rows.
update public.attachments a
set size = (o.metadata->>'size')::int
from storage.objects o
where a.size is null
  and o.bucket_id = a.bucket
  and o.name = a.path
  and (o.metadata->>'size') is not null;
