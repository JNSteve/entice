-- 0064: uploaded (document-backed) SWMS.
--
-- A SWMS instance may now point at an uploaded PDF attachment instead of
-- carrying template structure. Sign-on, share links, versioning and audit are
-- unchanged. External signers read the PDF via a signed URL minted with the
-- anon key; the storage policy below allows that ONLY for the PDF of an active
-- SWMS that has a live signon share link.

------------------------------------------------------------------------------
-- 1. Column + FK (restrict: a PDF in use by a SWMS can't be deleted)
------------------------------------------------------------------------------

alter table swms_instances
  add column document_attachment_id uuid null;

alter table swms_instances
  add constraint swms_instances_document_attachment_id_fkey
  foreign key (document_attachment_id) references attachments(id) on delete restrict;

create index swms_instances_document_attachment_idx
  on swms_instances (document_attachment_id);

------------------------------------------------------------------------------
-- 2. get_shared_doc: SWMS payload carries the document (path only, no URL)
------------------------------------------------------------------------------

create or replace function get_shared_doc(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l share_links%rowtype;
  v_doc jsonb;
  v_project_name text;
begin
  select * into l from share_links
   where token = p_token and active
     and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  if l.kind = 'signon' and l.swms_instance_id is not null then
    select jsonb_build_object(
             'type','swms',
             'title', s.title, 'body', s.body,
             'hazards', s.hazards, 'version', s.version,
             'doc_control', s.doc_control,
             'hrcw_items', s.hrcw_items,
             'hrcw_answers', s.hrcw_answers,
             'requirements', s.requirements,
             'steps', s.steps,
             'stop_work_triggers', s.stop_work_triggers,
             'emergency_scenarios', s.emergency_scenarios,
             'emergency_contacts', s.emergency_contacts,
             'project_details', s.project_details,
             'references_list', s.references_list,
             'document', case when a.id is null then null else
               jsonb_build_object('bucket', a.bucket, 'path', a.path,
                                  'filename', a.filename) end),
           p.name
      into v_doc, v_project_name
      from swms_instances s
      left join projects p on p.id = s.project_id
      left join attachments a on a.id = s.document_attachment_id
     where s.id = l.swms_instance_id;
  elsif l.kind = 'signon' then
    select jsonb_build_object(
             'type','form',
             'name', t.name, 'kind', fs.kind,
             'schema', t.schema, 'version', fs.template_version,
             'requires_signon', t.requires_signon,
             'data', fs.data, 'submitted_at', fs.submitted_at),
           p.name
      into v_doc, v_project_name
      from form_submissions fs
      join form_templates t on t.id = fs.template_id
      left join projects p on p.id = fs.project_id
     where fs.id = l.form_submission_id;
  else -- subbie_swms
    select p.name into v_project_name from projects p where p.id = l.project_id;
    v_doc := jsonb_build_object('type','subbie_swms');
  end if;

  if v_doc is null then
    return null;
  end if;

  return jsonb_build_object(
    'kind', l.kind, 'label', l.label,
    'project_name', v_project_name, 'doc', v_doc);
end $$;

grant execute on function get_shared_doc(text) to anon, authenticated;

------------------------------------------------------------------------------
-- 3. Anon read of a live shared SWMS PDF (for signed-URL minting only)
------------------------------------------------------------------------------

create or replace function is_shared_swms_document(p_bucket text, p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from share_links l
      join swms_instances s on s.id = l.swms_instance_id
      join attachments a on a.id = s.document_attachment_id
     where l.kind = 'signon'
       and l.active
       and (l.expires_at is null or l.expires_at > now())
       and s.status = 'active'
       and a.bucket = p_bucket
       and a.path = p_path
  )
$$;

revoke all on function is_shared_swms_document(text, text) from public;
grant execute on function is_shared_swms_document(text, text) to anon, authenticated;

drop policy if exists "attachments_select_shared_swms_doc" on storage.objects;
create policy "attachments_select_shared_swms_doc" on storage.objects
  for select to anon
  using (
    bucket_id = 'attachments'
    and public.is_shared_swms_document(bucket_id, name)
  );
