-- 0065: harden the 0064 anon storage policy (final-review I2).
--
-- attachments_select_shared_swms_doc called is_shared_swms_document for every
-- candidate object on any anon storage SELECT (incl. bucket list calls), and
-- attachments had no index on (bucket, path) — so each call scanned the table.
--   * index attachments(bucket, path) → the function is all indexed lookups
--   * only job/ and project/ objects can back a SWMS, so skip the function
--     for every other prefix

create index if not exists attachments_bucket_path_idx on attachments (bucket, path);

drop policy if exists "attachments_select_shared_swms_doc" on storage.objects;
create policy "attachments_select_shared_swms_doc" on storage.objects
  for select to anon
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in ('job', 'project')
    and public.is_shared_swms_document(bucket_id, name)
  );
