import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fmtDate } from '@/lib/format'
import { todayAU, dateAU } from '@/lib/tz'
import {
  derivePropertyItemStatus,
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import {
  ComplianceReportPdf,
  type ComplianceReportData,
  type ReportSite,
} from './ComplianceReportPdf'
import { toDocCompany, type SettingsRow } from './build-quote-pdf'

/**
 * Shared property-compliance-report builder used by BOTH the office route
 * (/api/pdf/compliance-report/[clientId], authed client) and the portal
 * proxy (/portal/[token]/report-pdf, service-role client after the token
 * check). Register status + works history only — money never appears.
 */
export async function buildComplianceReportResponse(
  supabase: SupabaseClient,
  clientId: string,
  opts: { watermark?: string | null } = {}
): Promise<Response> {
  const today = todayAU()
  const horizon30 = dateAU(30)
  const horizon90 = dateAU(90)

  const [{ data: client }, { data: sites }, { data: settings }] =
    await Promise.all([
      supabase
        .from('clients')
        .select('id, name')
        .eq('id', clientId)
        .eq('archived', false)
        .single(),
      supabase
        .from('sites')
        .select('id, name, address, suburb, state, postcode')
        .eq('client_id', clientId)
        .order('name'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])
  if (!client) return new Response('Not found', { status: 404 })

  const siteIds = (sites ?? []).map((s) => s.id as string)
  const [{ data: items }, { data: jobs }, { data: projects }] =
    siteIds.length > 0
      ? await Promise.all([
          supabase
            .from('property_compliance_items')
            .select('site_id, kind, title, issue_date, review_due')
            .eq('status', 'active')
            .in('site_id', siteIds)
            .order('review_due', { ascending: true, nullsFirst: false }),
          supabase
            .from('jobs')
            .select('site_id, number, title, completed_at')
            .in('site_id', siteIds)
            .in('status', ['completed', 'invoiced', 'paid'])
            .order('completed_at', { ascending: false }),
          supabase
            .from('projects')
            .select('site_id, number, name, practical_completion_date')
            .in('site_id', siteIds)
            .eq('status', 'closed'),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }]

  let current = 0
  let dueSoon = 0
  let overdue = 0
  const upcoming: ComplianceReportData['upcoming'] = []

  const reportSites: ReportSite[] = (sites ?? []).map((site) => {
    const siteItems = (items ?? [])
      .filter((i) => i.site_id === site.id)
      .map((i) => {
        const status = derivePropertyItemStatus(
          (i.review_due as string | null) ?? null,
          today
        )
        if (status === 'green') current += 1
        else if (status === 'amber') dueSoon += 1
        else overdue += 1

        const kindLabel =
          PROPERTY_COMPLIANCE_KIND_LABELS[i.kind as PropertyComplianceKind] ??
          (i.kind as string)
        const reviewDue = (i.review_due as string | null) ?? null
        if (reviewDue && reviewDue <= horizon90) {
          upcoming.push({
            label: `${site.name} — ${i.title} (${kindLabel})`,
            dueDisplay:
              reviewDue < today
                ? `overdue ${fmtDate(reviewDue)}`
                : fmtDate(reviewDue),
          })
        }
        return {
          kindLabel,
          title: i.title as string,
          issuedDisplay: fmtDate(i.issue_date as string),
          reviewDueDisplay: reviewDue ? fmtDate(reviewDue) : null,
          status,
        }
      })

    const works = [
      ...(jobs ?? [])
        .filter((j) => j.site_id === site.id)
        .map((j) => ({
          label: `${j.number} — ${j.title}`,
          completedDisplay: j.completed_at
            ? fmtDate((j.completed_at as string).slice(0, 10))
            : null,
        })),
      ...(projects ?? [])
        .filter((p) => p.site_id === site.id)
        .map((p) => ({
          label: `${p.number} — ${p.name}`,
          completedDisplay: p.practical_completion_date
            ? fmtDate(p.practical_completion_date as string)
            : null,
        })),
    ].slice(0, 15)

    const address =
      [
        site.address,
        [site.suburb, site.state, site.postcode].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', ') || null

    return { name: site.name as string, address, items: siteItems, works }
  })

  const data: ComplianceReportData = {
    clientName: client.name as string,
    generatedDisplay: fmtDate(today),
    summary: {
      properties: reportSites.length,
      current,
      dueSoon,
      overdue,
    },
    upcoming: upcoming.sort((a, b) => a.dueDisplay.localeCompare(b.dueDisplay)),
    sites: reportSites,
  }
  // horizon30 folds into derivePropertyItemStatus's amber rule; referenced to
  // make the 30-day summary column's meaning explicit at the data layer.
  void horizon30

  const buffer = await renderToBuffer(
    <ComplianceReportPdf
      data={data}
      company={toDocCompany((settings ?? null) as SettingsRow | null)}
      watermark={opts.watermark ?? null}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="compliance-report-${today}.pdf"`,
    },
  })
}
