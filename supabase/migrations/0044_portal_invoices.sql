-- Invoices become openable in the portal: billing rows carry the invoice id
-- and a token-gated entitlement fn guards the watermarked PDF proxy
-- (/portal/[token]/invoice-pdf/[id]).

-- portal_billing: add 'id' per row (invoice uuid / claim uuid; only invoice
-- ids are consumed — the portal renders a download link for invoices).
create or replace function portal_billing(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(row_j order by row_j->>'date' desc, row_j->>'number')
    from (
      select jsonb_build_object(
        'kind', 'invoice',
        'id', i.id,
        'number', i.number,
        'context', j.number || ' — ' || j.title,
        'date', i.issue_date,
        'amount', (select round(coalesce(sum(round(il.qty * il.unit_sell, 2)), 0)
                          * (1 + i.gst_rate / 100), 2)
                     from invoice_lines il where il.invoice_id = i.id),
        'status', i.status) as row_j
      from invoices i
      join jobs j on j.id = i.job_id and j.site_id = p_site
      where i.client_id = l.client_id
        and i.status in ('sent','paid')

      union all

      select jsonb_build_object(
        'kind', 'claim',
        'id', c.id,
        'number', p.number || ' · Claim ' || c.number::text,
        'context', p.number || ' — ' || p.name,
        'date', c.reference_date,
        'amount', c.total_inc_gst,
        'status', c.status) as row_j
      from claims c
      join projects p on p.id = c.project_id
        and p.site_id = p_site and p.client_id = l.client_id
      where c.status in ('submitted','certified','paid')
    ) rows
  ), '[]'::jsonb);
end $$;

-- Entitlement gate for the portal invoice PDF: the link must be live with
-- billing enabled, and the invoice must be the client's own, sent or paid.
-- Logs the download to portal_views. Returns null when not entitled.
create function portal_invoice_file(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_number text;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  select i.number into v_number
  from invoices i
  where i.id = p_id
    and i.client_id = l.client_id
    and i.status in ('sent','paid');
  if v_number is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, null, left('file:invoice:' || v_number, 300));

  return jsonb_build_object('ok', true, 'number', v_number);
end $$;
grant execute on function portal_invoice_file(text, uuid) to anon, authenticated;
