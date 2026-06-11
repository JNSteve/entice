insert into storage.buckets (id, name, public)
values ('attachments','attachments',false), ('branding','branding',true)
on conflict (id) do nothing;

-- attachments: any authenticated user may upload and read; only admin/office may delete
create policy "attachments_insert_authenticated" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');
create policy "attachments_select_authenticated" on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
create policy "attachments_delete_staff" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and current_app_role() in ('admin','office'));

-- branding: public read (bucket is public anyway for direct URLs); admin write
create policy "branding_select_all" on storage.objects for select
  using (bucket_id = 'branding');
create policy "branding_write_admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and current_app_role() = 'admin');
create policy "branding_update_admin" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and current_app_role() = 'admin');
create policy "branding_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and current_app_role() = 'admin');
