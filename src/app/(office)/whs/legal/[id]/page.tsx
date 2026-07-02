import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAuditFor } from '@/lib/audit-queries'
import type { AuditRow } from '@/lib/audit-queries'
import type {
  LegalCategory,
  LegalJurisdiction,
  RiskDomain,
  ComplianceState,
  ComplianceVerdict,
  ObligationStatus,
} from '@/lib/zod'
import type { DocumentOption, ProfileOption } from '../legal-client'
import {
  LegalDetailClient,
  type ObligationDetailData,
  type EvaluationRow,
  type NcrOption,
} from './legal-detail'

export default async function LegalObligationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: obligation },
    { data: evaluations },
    { data: documents },
    { data: profileRows },
    { data: openNcrs },
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('legal_obligations')
      .select(
        `id, number, title, category, jurisdiction, iso_domain,
         summary, how_it_applies, how_we_comply,
         controlling_document_id, responsible_id,
         review_frequency_months, next_review_date, current_compliance,
         status, created_at,
         controlling_document:documents!legal_obligations_controlling_document_id_fkey(doc_number, title),
         responsible:profiles!legal_obligations_responsible_id_fkey(full_name),
         creator:profiles!legal_obligations_created_by_fkey(full_name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('compliance_evaluations')
      .select(
        `id, evaluated_on, verdict, notes, ncr_id, created_at,
         evaluator:profiles!compliance_evaluations_evaluator_id_fkey(full_name),
         ncrs(number, status)`
      )
      .eq('obligation_id', id)
      .order('evaluated_on', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('documents')
      .select('id, doc_number, title')
      .in('status', ['draft', 'in_review', 'approved', 'issued'])
      .order('doc_number', { nullsFirst: false })
      .order('title'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
    supabase
      .from('ncrs')
      .select('id, number, title, status')
      .neq('status', 'closed')
      .order('number', { ascending: false }),
    fetchAuditFor(supabase, 'legal_obligations', id),
  ])

  if (!obligation) notFound()

  const doc = obligation.controlling_document as unknown as {
    doc_number: string | null
    title: string
  } | null
  const responsible = obligation.responsible as unknown as {
    full_name: string
  } | null
  const creator = obligation.creator as unknown as { full_name: string } | null

  const data: ObligationDetailData = {
    id: obligation.id as string,
    number: obligation.number as string,
    title: obligation.title as string,
    category: obligation.category as LegalCategory,
    jurisdiction: obligation.jurisdiction as LegalJurisdiction,
    iso_domain: obligation.iso_domain as RiskDomain,
    summary: (obligation.summary as string | null) ?? null,
    how_it_applies: (obligation.how_it_applies as string | null) ?? null,
    how_we_comply: (obligation.how_we_comply as string | null) ?? null,
    controlling_document_id:
      (obligation.controlling_document_id as string | null) ?? null,
    controlling_doc_label: doc
      ? doc.doc_number
        ? `${doc.doc_number} — ${doc.title}`
        : doc.title
      : null,
    responsible_id: (obligation.responsible_id as string | null) ?? null,
    responsible_name: responsible?.full_name ?? null,
    review_frequency_months: Number(obligation.review_frequency_months),
    next_review_date: (obligation.next_review_date as string | null) ?? null,
    current_compliance: obligation.current_compliance as ComplianceState,
    status: obligation.status as ObligationStatus,
    created_by_name: creator?.full_name ?? null,
    created_at: obligation.created_at as string,
  }

  const evaluationRows: EvaluationRow[] = (evaluations ?? []).map((e) => {
    const evaluator = e.evaluator as unknown as { full_name: string } | null
    const ncr = e.ncrs as unknown as { number: string; status: string } | null
    return {
      id: e.id as string,
      evaluated_on: e.evaluated_on as string,
      verdict: e.verdict as ComplianceVerdict,
      notes: (e.notes as string | null) ?? null,
      evaluator_name: evaluator?.full_name ?? null,
      ncr_id: (e.ncr_id as string | null) ?? null,
      ncr_number: ncr?.number ?? null,
      ncr_status: ncr?.status ?? null,
      created_at: e.created_at as string,
    }
  })

  const documentOptions: DocumentOption[] = (documents ?? []).map((d) => ({
    id: d.id as string,
    label: d.doc_number
      ? `${d.doc_number} — ${d.title as string}`
      : (d.title as string),
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  const ncrOptions: NcrOption[] = (openNcrs ?? []).map((n) => ({
    id: n.id as string,
    number: n.number as string,
    title: n.title as string,
    status: n.status as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/whs/legal"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Legal & compliance obligations register
      </Link>
      <LegalDetailClient
        obligation={data}
        evaluations={evaluationRows}
        role={profile.role as 'admin' | 'office' | 'supervisor'}
        documents={documentOptions}
        profiles={profileOptions}
        ncrs={ncrOptions}
        auditHistory={auditHistory as AuditRow[]}
      />
    </div>
  )
}
