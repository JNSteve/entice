import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, fmtDate } from '@/lib/format'
import { ArrowLeftIcon } from 'lucide-react'
import type { PackageRow, CostCodeOption, OwnerOption } from '../packages-table'
import { EditPackageButton } from './edit-package-button'
import { RfqSection, type RfqRow, type RfqVendorOption } from './rfq-section'
import { ComparisonSection, type QuoteRow } from './comparison-section'
import {
  AwardSection,
  type AwardQuoteOption,
  type AwardedCommitment,
} from './award-section'

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string; packageId: string }>
}) {
  const profile = await requireRole('admin', 'office')

  const { id: projectId, packageId } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: pkg },
    { data: rfqRows },
    { data: quoteRows },
    { data: vendorRows },
    { data: commitmentRows },
    { data: costCodes },
    { data: owners },
    { data: settings },
  ] = await Promise.all([
    supabase.from('projects').select('id, name, number').eq('id', projectId).single(),
    supabase
      .from('packages')
      .select(
        'id, name, status, budget_amount, cost_code_id, owner_id, let_by_date, notes, cost_codes(code, name), profiles(full_name)'
      )
      .eq('id', packageId)
      .eq('project_id', projectId)
      .single(),
    supabase
      .from('package_rfqs')
      .select('id, vendor_id, status, invited_at, vendors(name)')
      .eq('package_id', packageId)
      .order('invited_at', { ascending: true }),
    supabase
      .from('package_quotes')
      .select(
        'id, vendor_id, amount, inclusions, exclusions, notes, recommended, received_at, vendors(name)'
      )
      .eq('package_id', packageId)
      .order('amount', { ascending: true }),
    supabase
      .from('vendors')
      .select('id, name, email, trades, vendor_compliance_docs(expiry_date)')
      .eq('archived', false)
      .order('name'),
    supabase
      .from('commitments')
      .select('id, amount, date, description, vendors(name)')
      .eq('package_id', packageId)
      .eq('status', 'active')
      .order('date', { ascending: false }),
    supabase.from('cost_codes').select('id, code, name').eq('active', true).order('code'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .in('role', ['admin', 'office'])
      .eq('active', true)
      .order('full_name'),
    supabase.from('settings').select('company_name').eq('id', 1).single(),
  ])

  if (!project || !pkg) notFound()

  const attachments = await fetchAttachmentsWithUrls(supabase, 'package', packageId)

  // ── Shape data for client sections ──────────────────────────────────────────

  const costCodeRel = pkg.cost_codes as unknown as { code: string; name: string } | null
  const ownerRel = pkg.profiles as unknown as { full_name: string } | null

  const packageRow: PackageRow = {
    id: pkg.id,
    name: pkg.name,
    status: pkg.status,
    budget_amount: Number(pkg.budget_amount),
    awarded_amount: null,
    cost_code_id: pkg.cost_code_id ?? null,
    cost_code_code: costCodeRel?.code ?? null,
    cost_code_name: costCodeRel?.name ?? null,
    owner_id: pkg.owner_id ?? null,
    owner_name: ownerRel?.full_name ?? null,
    let_by_date: pkg.let_by_date ?? null,
    notes: pkg.notes ?? null,
  }

  const rfqs: RfqRow[] = (rfqRows ?? []).map((r) => {
    const vendorRel = r.vendors as unknown as { name: string } | null
    return {
      id: r.id,
      vendor_id: r.vendor_id,
      vendor_name: vendorRel?.name ?? 'Unknown supplier',
      status: r.status,
      invited_at: r.invited_at,
    }
  })

  const quotes: QuoteRow[] = (quoteRows ?? []).map((q) => ({
    id: q.id,
    vendor_id: q.vendor_id,
    amount: Number(q.amount),
    inclusions: q.inclusions ?? null,
    exclusions: q.exclusions ?? null,
    notes: q.notes ?? null,
    recommended: q.recommended,
    received_at: q.received_at,
  }))

  const vendorNameById = new Map(
    (vendorRows ?? []).map((v) => [v.id, v.name as string])
  )
  for (const r of rfqs) vendorNameById.set(r.vendor_id, r.vendor_name)

  const awardQuotes: AwardQuoteOption[] = (quoteRows ?? []).map((q) => {
    const vendorRel = q.vendors as unknown as { name: string } | null
    return {
      id: q.id,
      vendor_id: q.vendor_id,
      vendor_name: vendorRel?.name ?? vendorNameById.get(q.vendor_id) ?? 'Unknown supplier',
      amount: Number(q.amount),
      recommended: q.recommended,
    }
  })

  const vendors: RfqVendorOption[] = (vendorRows ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    email: v.email ?? null,
    trades: (v.trades as string[] | null) ?? [],
    compliance_docs:
      (v.vendor_compliance_docs as { expiry_date: string }[] | null) ?? [],
  }))

  const awardedRow = (commitmentRows ?? [])[0] ?? null
  const awardedCommitment: AwardedCommitment | null =
    pkg.status === 'awarded' && awardedRow
      ? {
          id: awardedRow.id,
          vendor_name:
            (awardedRow.vendors as unknown as { name: string } | null)?.name ??
            'Unknown supplier',
          amount: Number(awardedRow.amount),
          date: awardedRow.date,
          description: awardedRow.description,
        }
      : null

  const costCodeOptions: CostCodeOption[] = (costCodes ?? []).map((cc) => ({
    id: cc.id,
    code: cc.code,
    name: cc.name,
  }))

  const ownerOptions: OwnerOption[] = (owners ?? []).map((o) => ({
    id: o.id,
    full_name: o.full_name,
  }))

  const showComparison = rfqs.length > 0
  const showAward =
    quotes.length > 0 || quotes.some((q) => q.recommended) || pkg.status === 'awarded'

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link
          href={`/projects/${projectId}/procurement`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Procurement schedule
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">{pkg.name}</h2>
              <StatusBadge status={pkg.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                Budget:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {aud(Number(pkg.budget_amount))}
                </span>
              </span>
              <span>
                Cost code:{' '}
                {costCodeRel ? `${costCodeRel.code} — ${costCodeRel.name}` : '—'}
              </span>
              <span>
                Let by: {pkg.let_by_date ? fmtDate(pkg.let_by_date) : '—'}
              </span>
              <span>Owner: {ownerRel?.full_name ?? '—'}</span>
            </div>
            {pkg.notes && (
              <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
                {pkg.notes}
              </p>
            )}
          </div>
          <EditPackageButton
            projectId={projectId}
            pkg={packageRow}
            costCodes={costCodeOptions}
            owners={ownerOptions}
          />
        </div>
      </div>

      {/* RFQ section */}
      <RfqSection
        projectId={projectId}
        packageId={packageId}
        packageName={pkg.name}
        projectName={project.name}
        packageNotes={pkg.notes ?? null}
        letByDate={pkg.let_by_date ?? null}
        companyName={settings?.company_name ?? 'Company'}
        vendors={vendors}
        rfqs={rfqs}
        attachments={attachments}
      />

      {/* Quote comparison */}
      {showComparison && (
        <ComparisonSection
          projectId={projectId}
          packageId={packageId}
          budgetAmount={Number(pkg.budget_amount)}
          rfqs={rfqs}
          quotes={quotes}
          awarded={pkg.status === 'awarded'}
        />
      )}

      {/* Award */}
      {showAward && (
        <AwardSection
          projectId={projectId}
          packageId={packageId}
          packageName={pkg.name}
          budgetAmount={Number(pkg.budget_amount)}
          packageCostCodeId={pkg.cost_code_id ?? null}
          quotes={awardQuotes}
          costCodes={costCodeOptions}
          awardedCommitment={awardedCommitment}
          isAdmin={profile.role === 'admin'}
        />
      )}
    </div>
  )
}
