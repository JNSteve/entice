'use client'

import React, { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CopyIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhotoUpload } from '@/components/PhotoUpload'
import { cn } from '@/lib/utils'
import { todayAUClient } from '@/lib/tz-client'
import { looksLikePoBox } from '@/lib/waste/address'
import {
  ASBESTOS_WASTE_CODE,
  BUDF_UNITS,
  BUDF_UNIT_LABELS,
  DG_PACKING_GROUPS,
  DG_PACKING_GROUP_LABELS,
  PHYSICAL_NATURES,
  PHYSICAL_NATURE_LABELS,
  WASTE_CODES,
  type BudfUnit,
  type PhysicalNature,
} from '@/lib/waste/qld-codes'
import {
  createRegulatedMovement,
  type MovementLinks,
} from '@/app/(office)/whs/env/regulated/actions'

export interface RegulatedProjectOption {
  id: string
  label: string
  clientId: string | null
  clientName: string | null
  clientAbn: string | null
  clientContactName: string | null
  clientContactNumber: string | null
  siteId: string | null
  streetNumber: string
  streetName: string
  suburb: string
  postcode: string
}

export interface RegulatedTransporterOption {
  id: string
  name: string
  abn: string | null
  contactName: string | null
  contactNumber: string | null
  streetNumber: string
  streetName: string
  suburb: string
  postcode: string
  eaNumber: string | null
  eaExpiry: string | null
}

export interface RegulatedFacilityOption {
  id: string
  name: string
  abn: string | null
  eaNumber: string | null
  licenceExpiry: string | null
  streetNumber: string
  streetName: string
  suburb: string
  postcode: string
  contactName: string
  contactNumber: string
}

export interface CompanyGenerator {
  name: string
  abn: string | null
  streetNumber: string
  streetName: string
  contactName: string
  contactNumber: string
}

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-sm appearance-none'

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function QrPanel({ label, url }: { label: string; url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    QRCode.toDataURL(url, { width: 480, margin: 1 })
      .then((d) => {
        if (active) setDataUrl(d)
      })
      .catch(() => {
        if (active) setDataUrl(null)
      })
    return () => {
      active = false
    }
  }, [url])

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={`QR code — ${label}`} className="size-40" />
      ) : (
        <div className="flex size-40 items-center justify-center text-xs text-muted-foreground">
          Generating…
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard
            ?.writeText(url)
            .then(() => toast.success('Link copied'))
            .catch(() => toast.error('Could not copy'))
        }}
      >
        <CopyIcon className="size-3.5" />
        Copy link
      </Button>
    </div>
  )
}

export function RegulatedWasteForm({
  projects,
  jobs,
  transporters,
  facilities,
  company,
  defaultProjectId,
}: {
  projects: RegulatedProjectOption[]
  jobs: { id: string; label: string }[]
  transporters: RegulatedTransporterOption[]
  facilities: RegulatedFacilityOption[]
  company: CompanyGenerator
  defaultProjectId: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [created, setCreated] = useState<{
    id: string
    loadSeq: number
    links: MovementLinks | null
  } | null>(null)
  const [showDg, setShowDg] = useState(false)

  /**
   * The generator snapshot prefill. Derived in the change handlers rather than
   * an effect — an effect here would cascade renders, and these values are a
   * STARTING POINT the operator may correct. Whatever is on screen at save is
   * what gets snapshotted onto the statutory record.
   *
   * The address always stays the site's: the waste came from there regardless
   * of which party is named as the generator.
   */
  function generatorDefaults(
    kind: 'client' | 'company',
    p: RegulatedProjectOption | null
  ) {
    const address = {
      generator_street_number: p?.streetNumber ?? '',
      generator_street_name: p?.streetName ?? '',
      generator_suburb: p?.suburb ?? '',
      generator_postcode: p?.postcode ?? '',
    }
    if (kind === 'company') {
      return {
        ...address,
        generator_name: company.name,
        generator_abn: company.abn ?? '',
        generator_contact_name: company.contactName,
        generator_contact_number: company.contactNumber,
      }
    }
    return {
      ...address,
      generator_name: p?.clientName ?? '',
      generator_abn: p?.clientAbn ?? '',
      generator_contact_name: p?.clientContactName ?? '',
      generator_contact_number: p?.clientContactNumber ?? '',
    }
  }

  const [form, setForm] = useState(() => ({
    project_id: defaultProjectId ?? '',
    job_id: '',
    generator_kind: 'client' as 'client' | 'company',
    ...generatorDefaults(
      'client',
      projects.find((p) => p.id === defaultProjectId) ?? null
    ),
    local_government_area: '',
    waste_physical_nature: 'S' as PhysicalNature,
    waste_code: ASBESTOS_WASTE_CODE,
    waste_amount: '',
    waste_unit: 'm3' as BudfUnit,
    waste_description: '',
    dg_un_class: '',
    dg_un_number: '',
    dg_subsidiary_risk: '',
    dg_packaging_count: '',
    dg_packaging_type: '',
    dg_packing_group: '',
    transporter_vendor_id: '',
    receiver_facility_id: '',
    notes: '',
  }))

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const project = projects.find((p) => p.id === form.project_id) ?? null
  const transporter =
    transporters.find((v) => v.id === form.transporter_vendor_id) ?? null
  const facility = facilities.find((f) => f.id === form.receiver_facility_id) ?? null
  const today = todayAUClient()

  function pickProject(projectId: string) {
    const next = projects.find((p) => p.id === projectId) ?? null
    setForm((f) => ({
      ...f,
      project_id: projectId,
      job_id: projectId ? '' : f.job_id,
      ...generatorDefaults(f.generator_kind, next),
    }))
  }

  function pickGeneratorKind(kind: 'client' | 'company') {
    setForm((f) => ({
      ...f,
      generator_kind: kind,
      ...generatorDefaults(kind, projects.find((p) => p.id === f.project_id) ?? null),
    }))
  }

  // s96: a load cannot proceed without the transporter's authority number.
  const eaMissing = Boolean(transporter && !transporter.eaNumber)
  const eaExpired = Boolean(
    transporter?.eaExpiry && transporter.eaExpiry < today
  )

  const warnings: string[] = []
  if (eaExpired && transporter) {
    warnings.push(
      `${transporter.name}'s environmental authority expired ${transporter.eaExpiry}.`
    )
  }
  if (facility?.licenceExpiry && facility.licenceExpiry < today) {
    warnings.push(`${facility.name}'s licence expired ${facility.licenceExpiry}.`)
  }
  if (looksLikePoBox(`${form.generator_street_number} ${form.generator_street_name}`)) {
    warnings.push(
      'The generator address looks like a PO Box. The specification requires a physical address.'
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.project_id && !form.job_id) {
      toast.error('Pick a project or job')
      return
    }
    if (!transporter) {
      toast.error('Pick the transporter')
      return
    }
    if (eaMissing) {
      toast.error('This transporter has no environmental authority number')
      return
    }
    if (!facility) {
      toast.error('Pick the receiving facility')
      return
    }
    if (!form.waste_amount || Number(form.waste_amount) <= 0) {
      toast.error('Enter the amount')
      return
    }

    startTransition(async () => {
      const result = await createRegulatedMovement(
        {
          project_id: form.project_id || null,
          job_id: form.project_id ? null : form.job_id || null,
          permit_id: null,
          generator_kind: form.generator_kind,
          generator_client_id:
            form.generator_kind === 'client' ? (project?.clientId ?? null) : null,
          generator_site_id: project?.siteId ?? null,
          generator_name: form.generator_name,
          generator_abn: form.generator_abn || null,
          generator_street_number: form.generator_street_number,
          generator_street_name: form.generator_street_name,
          generator_suburb: form.generator_suburb,
          generator_postcode: form.generator_postcode,
          generator_contact_name: form.generator_contact_name,
          generator_contact_number: form.generator_contact_number,
          collection_date: today,
          local_government_area: form.local_government_area || null,
          waste_physical_nature: form.waste_physical_nature,
          waste_code: form.waste_code,
          waste_amount: form.waste_amount,
          waste_unit: form.waste_unit,
          waste_description: form.waste_description || null,
          consignment_authorisation: null,
          dg_un_class: form.dg_un_class || null,
          dg_un_number: form.dg_un_number || null,
          dg_subsidiary_risk: form.dg_subsidiary_risk || null,
          dg_packaging_count: form.dg_packaging_count || null,
          dg_packaging_type: form.dg_packaging_type || null,
          dg_packing_group: form.dg_packing_group || null,
          transporter_vendor_id: transporter.id,
          transporter_name: transporter.name,
          transporter_contact_name: transporter.contactName ?? '',
          transporter_contact_number: transporter.contactNumber ?? '',
          transporter_street_number: transporter.streetNumber,
          transporter_street_name: transporter.streetName,
          transporter_suburb: transporter.suburb,
          transporter_postcode: transporter.postcode,
          transporter_abn: transporter.abn,
          transporter_ea_number: transporter.eaNumber ?? '',
          receiver_facility_id: facility.id,
          receiver_ea_number: facility.eaNumber,
          receiver_name: facility.name,
          receiver_contact_name: facility.contactName,
          receiver_contact_number: facility.contactNumber,
          receiver_street_number: facility.streetNumber,
          receiver_street_name: facility.streetName,
          receiver_suburb: facility.suburb,
          receiver_postcode: facility.postcode,
          receiver_abn: facility.abn,
          notes: form.notes || null,
        },
        window.location.origin
      )

      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(`Load ${String(result.loadSeq).padStart(7, '0')} recorded`)
      setCreated({ id: result.id, loadSeq: result.loadSeq, links: result.links })
    })
  }

  // ── Success: hand the driver their QR codes ──────────────────────────────
  if (created) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
          <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <span>
            Load {String(created.loadSeq).padStart(7, '0')} recorded. The
            department must be given this information within 7 days.
          </span>
        </div>

        {created.links ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Hand over to the driver
              </h2>
              <p className="text-xs text-muted-foreground">
                The driver scans the first code to record vehicles and collection.
                The weighbridge scans the second to record what was received.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <QrPanel label="Transporter — Part 2" url={created.links.transporterUrl} />
              <QrPanel label="Receiver — Part 3" url={created.links.receiverUrl} />
            </div>
          </section>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-amber-800 dark:text-amber-200">
              The load is saved, but the transporter and receiver links could not
              be issued. The office can issue them from the register.
            </span>
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Docket photo
          </h2>
          <PhotoUpload
            parentType="regulated_waste_movement"
            parentId={created.id}
            kind="docket"
            capture
            multiple
          />
        </section>

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              setCreated(null)
              setForm((f) => ({ ...f, waste_amount: '', waste_description: '', notes: '' }))
            }}
          >
            Record another load
          </Button>
          <Button render={<Link href="/field" />} size="lg" variant="ghost">
            Done
          </Button>
        </div>
      </div>
    )
  }

  // ── Capture ──────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Section title="Where from">
        {projects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Project</Label>
            <select
              className={selectClass}
              value={form.project_id}
              onChange={(e) => pickProject(e.target.value)}
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {jobs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>or Job</Label>
            <select
              className={selectClass}
              value={form.job_id}
              onChange={(e) => {
                field('job_id', e.target.value)
                if (e.target.value) field('project_id', '')
              }}
            >
              <option value="">—</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </Section>

      <Section
        title="Who generated this waste"
        hint="The generator must be whoever actually generated the waste — never the agent lodging on their behalf."
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => pickGeneratorKind('client')}
            aria-pressed={form.generator_kind === 'client'}
            className={cn(
              'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
              form.generator_kind === 'client'
                ? 'border-foreground bg-foreground text-background'
                : 'border-muted-foreground/30'
            )}
          >
            The client
            <span className="block truncate text-xs font-normal opacity-70">
              {project?.clientName ?? 'Pick a project'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => pickGeneratorKind('company')}
            aria-pressed={form.generator_kind === 'company'}
            className={cn(
              'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
              form.generator_kind === 'company'
                ? 'border-foreground bg-foreground text-background'
                : 'border-muted-foreground/30'
            )}
          >
            Us
            <span className="block truncate text-xs font-normal opacity-70">
              {company.name}
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Generator name</Label>
          <Input
            value={form.generator_name}
            onChange={(e) => field('generator_name', e.target.value)}
            maxLength={60}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>ABN / ACN (optional)</Label>
          <Input
            value={form.generator_abn}
            onChange={(e) => field('generator_abn', e.target.value)}
            inputMode="numeric"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex w-1/3 flex-col gap-1.5">
            <Label>Street no.</Label>
            <Input
              value={form.generator_street_number}
              onChange={(e) => field('generator_street_number', e.target.value)}
              maxLength={20}
              required
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Street name</Label>
            <Input
              value={form.generator_street_name}
              onChange={(e) => field('generator_street_name', e.target.value)}
              maxLength={40}
              required
            />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Suburb</Label>
            <Input
              value={form.generator_suburb}
              onChange={(e) => field('generator_suburb', e.target.value)}
              maxLength={25}
              required
            />
          </div>
          <div className="flex w-28 flex-col gap-1.5">
            <Label>Postcode</Label>
            <Input
              value={form.generator_postcode}
              onChange={(e) => field('generator_postcode', e.target.value)}
              inputMode="numeric"
              maxLength={4}
              required
            />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Contact name</Label>
            <Input
              value={form.generator_contact_name}
              onChange={(e) => field('generator_contact_name', e.target.value)}
              maxLength={50}
              required
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Contact number</Label>
            <Input
              value={form.generator_contact_number}
              onChange={(e) => field('generator_contact_number', e.target.value)}
              inputMode="tel"
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Local government area (optional)</Label>
          <Input
            value={form.local_government_area}
            onChange={(e) => field('local_government_area', e.target.value)}
            maxLength={50}
            placeholder="e.g. Brisbane City"
          />
        </div>
      </Section>

      <Section
        title="The waste"
        hint="Contaminated soil takes the code of its contaminant, not a soil code."
      >
        <div className="flex flex-col gap-2">
          <Label>Waste code</Label>
          <button
            type="button"
            onClick={() => field('waste_code', ASBESTOS_WASTE_CODE)}
            aria-pressed={form.waste_code === ASBESTOS_WASTE_CODE}
            className={cn(
              'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
              form.waste_code === ASBESTOS_WASTE_CODE
                ? 'border-foreground bg-foreground text-background'
                : 'border-muted-foreground/30'
            )}
          >
            Asbestos — N220
          </button>
          <select
            className={selectClass}
            value={form.waste_code}
            onChange={(e) => field('waste_code', e.target.value)}
          >
            {WASTE_CODES.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} — {w.description.slice(0, 70)}
                {w.description.length > 70 ? '…' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Physical nature</Label>
          <div className="grid grid-cols-4 gap-2">
            {PHYSICAL_NATURES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => field('waste_physical_nature', n)}
                aria-pressed={form.waste_physical_nature === n}
                className={cn(
                  'rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                  form.waste_physical_nature === n
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-muted-foreground/30'
                )}
              >
                {PHYSICAL_NATURE_LABELS[n]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={form.waste_amount}
              onChange={(e) => field('waste_amount', e.target.value)}
              required
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Label>Unit</Label>
            <select
              className={selectClass}
              value={form.waste_unit}
              onChange={(e) => field('waste_unit', e.target.value as BudfUnit)}
            >
              {BUDF_UNITS.map((u) => (
                <option key={u} value={u}>
                  {BUDF_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Description (optional)</Label>
          <Input
            value={form.waste_description}
            onChange={(e) => field('waste_description', e.target.value)}
            maxLength={225}
            placeholder="e.g. Bonded asbestos cement sheeting, double wrapped"
          />
        </div>
      </Section>

      <Section title="Transporter">
        <div className="flex flex-col gap-1.5">
          <Label>Carrier</Label>
          <select
            className={selectClass}
            value={form.transporter_vendor_id}
            onChange={(e) => field('transporter_vendor_id', e.target.value)}
          >
            <option value="">—</option>
            {transporters.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.eaNumber ? '' : ' — no EA number'}
              </option>
            ))}
          </select>
        </div>

        {transporters.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No transporters are set up yet. The office adds them in the vendor
            register and records their environmental authority number.
          </p>
        )}

        {transporter && !eaMissing && (
          <p className="text-xs text-muted-foreground">
            EA {transporter.eaNumber}
            {transporter.eaExpiry ? ` · expires ${transporter.eaExpiry}` : ''}
          </p>
        )}

        {eaMissing && (
          <div className="flex items-start gap-2 rounded-xl border border-red-400 bg-red-50 p-3 text-sm dark:border-red-700 dark:bg-red-950">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex flex-col gap-1 text-red-800 dark:text-red-200">
              <p className="font-medium">
                This load cannot proceed with {transporter?.name}.
              </p>
              <p>
                They have no environmental authority number on file. It is an
                offence under section 96 of the Environmental Protection
                Regulation 2019 to give trackable waste to an unauthorised
                transporter. Ring the office to record their EA number before
                the truck leaves.
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section title="Receiving facility">
        <div className="flex flex-col gap-1.5">
          <Label>Where it is going</Label>
          <select
            className={selectClass}
            value={form.receiver_facility_id}
            onChange={(e) => field('receiver_facility_id', e.target.value)}
          >
            <option value="">—</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        {facility?.eaNumber && (
          <p className="text-xs text-muted-foreground">EA {facility.eaNumber}</p>
        )}
        {facilities.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No facilities are flagged as receiving regulated waste yet. The
            office sets that on the facility record.
          </p>
        )}
      </Section>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <button
          type="button"
          onClick={() => setShowDg((s) => !s)}
          className="flex items-center justify-between gap-2 text-left"
        >
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Dangerous goods (optional)
          </span>
          <ChevronDownIcon
            className={cn('size-4 transition-transform', showDg && 'rotate-180')}
          />
        </button>
        {showDg && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>UN class</Label>
                <Input
                  value={form.dg_un_class}
                  onChange={(e) => field('dg_un_class', e.target.value)}
                  maxLength={2}
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>UN number</Label>
                <Input
                  value={form.dg_un_number}
                  onChange={(e) => field('dg_un_number', e.target.value)}
                  maxLength={4}
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Subsidiary risk</Label>
                <Input
                  value={form.dg_subsidiary_risk}
                  onChange={(e) => field('dg_subsidiary_risk', e.target.value)}
                  maxLength={2}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Bulk / no. of packages</Label>
                <Input
                  value={form.dg_packaging_count}
                  onChange={(e) => field('dg_packaging_count', e.target.value)}
                  maxLength={5}
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Packaging type</Label>
                <Input
                  value={form.dg_packaging_type}
                  onChange={(e) => field('dg_packaging_type', e.target.value)}
                  maxLength={20}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Packing group</Label>
              <select
                className={selectClass}
                value={form.dg_packing_group}
                onChange={(e) => field('dg_packing_group', e.target.value)}
              >
                <option value="">—</option>
                {DG_PACKING_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {DG_PACKING_GROUP_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </section>

      <Section title="Notes">
        <Textarea
          value={form.notes}
          onChange={(e) => field('notes', e.target.value)}
          placeholder="Anything the office should know about this load"
          rows={2}
        />
      </Section>

      {warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col gap-1">
            {warnings.map((w) => (
              <p key={w} className="text-amber-800 dark:text-amber-200">
                {w}
              </p>
            ))}
          </div>
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending || eaMissing}>
        {pending ? 'Recording…' : 'Record movement'}
      </Button>
    </form>
  )
}
