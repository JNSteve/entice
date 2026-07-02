import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import {
  LegalClient,
  type ObligationRow,
  type DocumentOption,
  type ProfileOption,
} from './legal-client'
import type {
  LegalCategory,
  LegalJurisdiction,
  RiskDomain,
  ComplianceState,
  ObligationStatus,
} from '@/lib/zod'

export default async function WhsLegalPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const [{ data: obligations }, { data: documents }, { data: profileRows }] =
    await Promise.all([
      supabase
        .from('legal_obligations')
        .select(
          `id, number, title, category, jurisdiction, iso_domain,
           next_review_date, current_compliance, status, review_frequency_months,
           controlling_document:documents!legal_obligations_controlling_document_id_fkey(doc_number, title),
           responsible:profiles!legal_obligations_responsible_id_fkey(full_name)`
        )
        .order('number'),
      supabase
        .from('documents')
        .select('id, doc_number, title, status')
        .in('status', ['draft', 'in_review', 'approved', 'issued'])
        .order('doc_number', { nullsFirst: false })
        .order('title'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name'),
    ])

  const rows: ObligationRow[] = (obligations ?? []).map((o) => {
    const doc = o.controlling_document as unknown as {
      doc_number: string | null
      title: string
    } | null
    const responsible = o.responsible as unknown as { full_name: string } | null
    return {
      id: o.id as string,
      number: o.number as string,
      title: o.title as string,
      category: o.category as LegalCategory,
      jurisdiction: o.jurisdiction as LegalJurisdiction,
      iso_domain: o.iso_domain as RiskDomain,
      next_review_date: (o.next_review_date as string | null) ?? null,
      current_compliance: o.current_compliance as ComplianceState,
      status: o.status as ObligationStatus,
      responsible_name: responsible?.full_name ?? null,
      controlling_doc_label: doc
        ? doc.doc_number
          ? `${doc.doc_number} — ${doc.title}`
          : doc.title
        : null,
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Legal & compliance obligations register"
        description="Legal and other requirements — legislation, regulations, codes, standards, permits, licences and client requirements — with periodic compliance evaluations against each (ISO 6.1.3 / 9.1.2)."
      />
      <LegalClient
        items={rows}
        documents={documentOptions}
        profiles={profileOptions}
        role={profile.role as 'admin' | 'office' | 'supervisor'}
      />
    </div>
  )
}
