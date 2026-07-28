import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fmtDate } from '@/lib/format'
import { splitStreetAddress } from '@/lib/waste/address'
import {
  RegulatedWasteForm,
  type CompanyGenerator,
  type RegulatedFacilityOption,
  type RegulatedProjectOption,
  type RegulatedTransporterOption,
} from './regulated-form'

export const dynamic = 'force-dynamic'

export default async function FieldRegulatedWastePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const supabase = await createClient()

  const [
    { data: projectRows },
    { data: jobRows },
    { data: vendorRows },
    { data: facilityRows },
    { data: settingsRow },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'id, number, name, client_id, site_id, clients(id, name, abn, contacts(name, phone)), sites(id, address, suburb, postcode)'
      )
      .eq('archived', false)
      .neq('status', 'closed')
      .order('number'),
    supabase
      .from('jobs')
      .select('id, number, title')
      .eq('archived', false)
      .not('status', 'in', '("invoiced","paid","lost")')
      .order('number'),
    // The EA number rides vendor_compliance_docs so it inherits the existing
    // 30-day expiry traffic light (migration 0054).
    supabase
      .from('vendors')
      .select(
        'id, name, abn, contact_name, phone, street_number, street_name, suburb, postcode, vendor_compliance_docs(kind, reference, expiry_date)'
      )
      .eq('is_waste_transporter', true)
      .eq('archived', false)
      .order('name'),
    supabase
      .from('env_facilities')
      .select(
        'id, name, abn, licence_no, licence_expiry, street_number, street_name, suburb, postcode, contact_name, contact_number'
      )
      .eq('receives_regulated', true)
      .eq('active', true)
      .order('name'),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone')
      .eq('id', 1)
      .single(),
    supabase
      .from('regulated_waste_movements')
      .select('id, load_seq, collection_date, waste_code, waste_amount, waste_unit')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  type ContactRow = { name: string | null; phone: string | null }
  type ClientRow = {
    id: string
    name: string | null
    abn: string | null
    contacts: ContactRow[] | null
  }
  type SiteRow = {
    id: string
    address: string | null
    suburb: string | null
    postcode: string | null
  }

  const projects: RegulatedProjectOption[] = (projectRows ?? []).map((p) => {
    const client = (p.clients as unknown as ClientRow | null) ?? null
    const site = (p.sites as unknown as SiteRow | null) ?? null
    const contact = client?.contacts?.[0] ?? null
    const split = splitStreetAddress(site?.address)
    return {
      id: p.id as string,
      label: `${p.number} — ${p.name}`,
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      clientAbn: client?.abn ?? null,
      clientContactName: contact?.name ?? null,
      clientContactNumber: contact?.phone ?? null,
      siteId: site?.id ?? null,
      streetNumber: split.streetNumber,
      streetName: split.streetName,
      suburb: site?.suburb ?? '',
      postcode: site?.postcode ?? '',
    }
  })

  const jobs = (jobRows ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number} — ${j.title}`,
  }))

  type ComplianceDoc = {
    kind: string
    reference: string | null
    expiry_date: string | null
  }

  const transporters: RegulatedTransporterOption[] = (vendorRows ?? []).map((v) => {
    const docs = (v.vendor_compliance_docs as unknown as ComplianceDoc[] | null) ?? []
    // Most distant expiry wins — a renewed authority supersedes the old row.
    const ea = docs
      .filter((d) => d.kind === 'environmental_authority' && d.reference)
      .sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''))
      .at(-1)
    return {
      id: v.id as string,
      name: v.name as string,
      abn: (v.abn as string | null) ?? null,
      contactName: (v.contact_name as string | null) ?? null,
      contactNumber: (v.phone as string | null) ?? null,
      streetNumber: (v.street_number as string | null) ?? '',
      streetName: (v.street_name as string | null) ?? '',
      suburb: (v.suburb as string | null) ?? '',
      postcode: (v.postcode as string | null) ?? '',
      eaNumber: ea?.reference ?? null,
      eaExpiry: ea?.expiry_date ?? null,
    }
  })

  const facilities: RegulatedFacilityOption[] = (facilityRows ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    abn: (f.abn as string | null) ?? null,
    // licence_no IS the environmental authority for a QLD facility (0054).
    eaNumber: (f.licence_no as string | null) ?? null,
    licenceExpiry: (f.licence_expiry as string | null) ?? null,
    streetNumber: (f.street_number as string | null) ?? '',
    streetName: (f.street_name as string | null) ?? '',
    suburb: (f.suburb as string | null) ?? '',
    postcode: (f.postcode as string | null) ?? '',
    contactName: (f.contact_name as string | null) ?? '',
    contactNumber: (f.contact_number as string | null) ?? '',
  }))

  const companySplit = splitStreetAddress(settingsRow?.address ?? null)
  const company: CompanyGenerator = {
    name: (settingsRow?.company_name as string | null) ?? '',
    abn: (settingsRow?.abn as string | null) ?? null,
    streetNumber: companySplit.streetNumber,
    streetName: companySplit.streetName,
    contactName: '',
    contactNumber: (settingsRow?.phone as string | null) ?? '',
  }

  const defaultProjectId =
    sp.project && projects.some((p) => p.id === sp.project) ? sp.project : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/waste"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Waste
        </Link>
        <h1 className="text-lg font-bold">Regulated waste movement</h1>
        <p className="text-sm text-muted-foreground">
          Trackable waste under Schedule 11 — asbestos, contaminated soil and
          regulated waste. The department must be given this information within
          7 days, and the record kept for 5 years.
        </p>
      </div>

      <RegulatedWasteForm
        projects={projects}
        jobs={jobs}
        transporters={transporters}
        facilities={facilities}
        company={company}
        defaultProjectId={defaultProjectId}
      />

      {(recent ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent tracked loads
          </h2>
          <div className="flex flex-col divide-y rounded-xl border">
            {(recent ?? []).map((m) => (
              <div
                key={m.id as string}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-sm font-medium">
                    Load {String(m.load_seq).padStart(7, '0')}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {m.waste_code as string} · {Number(m.waste_amount)}{' '}
                    {m.waste_unit as string}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {fmtDate(m.collection_date as string)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
