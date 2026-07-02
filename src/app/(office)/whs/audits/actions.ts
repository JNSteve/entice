'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, type Profile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { todayAU } from '@/lib/tz'
import { validateSubmissionData } from '@/lib/form-validate'
import {
  auditTransitionAllowed,
  auditCompleteError,
  auditCloseError,
  findingCloseError,
} from '@/lib/audit-gates'
import {
  auditProgrammeSchema,
  auditCreateSchema,
  auditUpdateSchema,
  auditStatusSchema,
  auditChecklistSchema,
  findingCreateSchema,
  findingUpdateSchema,
  findingRaiseNcrSchema,
  type FormField,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateAudits(auditId?: string) {
  revalidatePath('/whs/audits')
  if (auditId) revalidatePath(`/whs/audits/${auditId}`)
  revalidatePath('/whs')
}

/**
 * Loads an audit and enforces who may work on it: admin/office always;
 * a supervisor only when they are the named auditor (mirrors RLS, but
 * enforced here too so the rule is not bypassable via crafted calls).
 */
async function loadAuditForWork(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile,
  auditId: string
) {
  const { data: audit } = await supabase
    .from('audits')
    .select('id, status, auditor_id, checklist_template_id, checklist_submission_id')
    .eq('id', auditId)
    .single()
  if (!audit) return { error: 'Audit not found' as string, audit: null }
  if (profile.role === 'supervisor' && audit.auditor_id !== profile.id) {
    return {
      error: 'Supervisors can only work on audits where they are the auditor',
      audit: null,
    }
  }
  return { error: null, audit }
}

// ─── Programmes ───────────────────────────────────────────────────────────────

export async function createProgramme(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = auditProgrammeSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('audit_programmes')
    .insert({
      year: parsed.data.year,
      title: parsed.data.title,
      notes: parsed.data.notes,
      status: 'draft',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateAudits()
  return { id: row.id }
}

// Forward chain with an admin reopen, mirroring the register conventions.
const PROGRAMME_TRANSITIONS: Record<string, string[]> = {
  draft: ['active'],
  active: ['closed'],
  closed: ['active'], // admin reopen
}

export async function setProgrammeStatus(
  programmeId: string,
  status: string
): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('audit_programmes')
    .select('id, status')
    .eq('id', programmeId)
    .single()
  if (!existing) return { error: 'Programme not found' }

  const allowed = PROGRAMME_TRANSITIONS[existing.status] ?? []
  if (!allowed.includes(status)) {
    return { error: `Cannot move programme from ${existing.status} to ${status}` }
  }
  if (existing.status === 'closed' && profile.role !== 'admin') {
    return { error: 'Only admins can reopen a closed programme' }
  }

  const { error } = await supabase
    .from('audit_programmes')
    .update({ status })
    .eq('id', programmeId)
  if (error) return { error: error.message }

  revalidateAudits()
  return {}
}

// ─── Audits: plan / edit ──────────────────────────────────────────────────────

export async function createAudit(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = auditCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: programme } = await supabase
    .from('audit_programmes')
    .select('id, status')
    .eq('id', parsed.data.programme_id)
    .single()
  if (!programme) return { error: 'Programme not found' }
  if (programme.status === 'closed') {
    return { error: 'Cannot plan an audit into a closed programme' }
  }

  if (parsed.data.checklist_template_id) {
    const templateError = await checkAuditTemplate(
      supabase,
      parsed.data.checklist_template_id
    )
    if (templateError) return { error: templateError }
  }

  const number = await nextNumber(supabase, 'audit').catch((err) => {
    throw new Error(`Failed to get next audit number: ${err.message}`)
  })

  const { data: row, error } = await supabase
    .from('audits')
    .insert({
      number,
      programme_id: parsed.data.programme_id,
      area_id: parsed.data.area_id,
      standards: parsed.data.standards,
      auditor_id: parsed.data.auditor_id,
      auditee: parsed.data.auditee,
      planned_date: parsed.data.planned_date,
      checklist_template_id: parsed.data.checklist_template_id,
      status: 'planned',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateAudits(row.id)
  return { id: row.id }
}

/** The checklist must be an active 'audit'-kind template. */
async function checkAuditTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateId: string
): Promise<string | null> {
  const { data: template } = await supabase
    .from('form_templates')
    .select('id, kind, active')
    .eq('id', templateId)
    .single()
  if (!template) return 'Checklist template not found'
  if (template.kind !== 'audit') {
    return 'The checklist must be an audit-kind template'
  }
  if (!template.active) return 'This checklist template is no longer active'
  return null
}

export async function updateAudit(auditId: string, data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = auditUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { error: loadError, audit } = await loadAuditForWork(supabase, profile, auditId)
  if (loadError || !audit) return { error: loadError ?? 'Audit not found' }
  if (audit.status === 'closed') {
    return { error: 'Cannot edit a closed audit' }
  }

  // Swapping the checklist after it has been conducted would orphan the
  // submission from its template context — lock it once conducted.
  if (
    parsed.data.checklist_template_id !== undefined &&
    parsed.data.checklist_template_id !== audit.checklist_template_id
  ) {
    if (audit.checklist_submission_id) {
      return { error: 'The checklist has been conducted — it can no longer be swapped' }
    }
    if (parsed.data.checklist_template_id) {
      const templateError = await checkAuditTemplate(
        supabase,
        parsed.data.checklist_template_id
      )
      if (templateError) return { error: templateError }
    }
  }

  const { error } = await supabase.from('audits').update(parsed.data).eq('id', auditId)
  if (error) return { error: error.message }

  revalidateAudits(auditId)
  return {}
}

// ─── Audits: status transitions + close gates ─────────────────────────────────

export async function setAuditStatus(auditId: string, data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = auditStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { error: loadError, audit } = await loadAuditForWork(supabase, profile, auditId)
  if (loadError || !audit) return { error: loadError ?? 'Audit not found' }

  const target = parsed.data.status
  if (!auditTransitionAllowed(audit.status, target)) {
    return { error: `Cannot move from ${audit.status} to ${target}` }
  }

  // Reopen (closed → complete) is admin-only.
  if (audit.status === 'closed' && profile.role !== 'admin') {
    return { error: 'Only admins can reopen a closed audit' }
  }

  // ── Complete gate: the checklist must have been conducted ────────────────
  if (target === 'complete') {
    const completeError = auditCompleteError(Boolean(audit.checklist_submission_id))
    if (completeError) return { error: completeError }
  }

  // ── Close gate (NON-BYPASSABLE): no open findings ─────────────────────────
  if (target === 'closed') {
    const { count: openFindings } = await supabase
      .from('audit_findings')
      .select('id', { count: 'exact', head: true })
      .eq('audit_id', auditId)
      .eq('status', 'open')
    const closeError = auditCloseError(openFindings ?? 0)
    if (closeError) return { error: closeError }
  }

  const update: Record<string, unknown> = { status: target }
  if (target === 'closed') {
    update.closed_at = new Date().toISOString()
  } else if (audit.status === 'closed') {
    update.closed_at = null
  }

  const { error } = await supabase.from('audits').update(update).eq('id', auditId)
  if (error) return { error: error.message }

  revalidateAudits(auditId)
  return {}
}

// ─── Conduct the checklist ────────────────────────────────────────────────────

/**
 * Fills the audit checklist as an immutable form_submission (kind 'audit',
 * schema snapshot per 0018) and links it to the audit. Allowed only while the
 * audit is planned/in_progress — once the audit is complete the submission is
 * frozen (form_submissions has no UPDATE policy, and this action refuses to
 * create a replacement).
 */
export async function conductAuditChecklist(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = auditChecklistSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { error: loadError, audit } = await loadAuditForWork(
    supabase,
    profile,
    parsed.data.audit_id
  )
  if (loadError || !audit) return { error: loadError ?? 'Audit not found' }

  if (audit.status !== 'planned' && audit.status !== 'in_progress') {
    return { error: 'The checklist is frozen — this audit is already complete' }
  }
  if (!audit.checklist_template_id) {
    return { error: 'Pick a checklist template for this audit first' }
  }

  const { data: template } = await supabase
    .from('form_templates')
    .select('id, kind, schema, version, active')
    .eq('id', audit.checklist_template_id)
    .single()
  if (!template) return { error: 'Checklist template not found' }
  if (template.kind !== 'audit') {
    return { error: 'The checklist must be an audit-kind template' }
  }

  const validated = validateSubmissionData(
    (template.schema as FormField[]) ?? [],
    parsed.data.data
  )
  if (!validated.ok) {
    const first = Object.values(validated.errors)[0]
    return { error: first ?? 'The checklist has missing or invalid answers' }
  }

  const { data: submission, error: submissionError } = await supabase
    .from('form_submissions')
    .insert({
      template_id: template.id,
      template_version: Number(template.version),
      // Snapshot so the conducted checklist always renders against the field
      // set it was captured with (0018 pattern).
      schema_snapshot: template.schema,
      kind: 'audit',
      data: validated.data,
      submitted_by: profile.id,
    })
    .select('id')
    .single()
  if (submissionError) return { error: submissionError.message }

  const { error, count } = await supabase
    .from('audits')
    .update(
      {
        checklist_submission_id: submission.id,
        conducted_date: todayAU(),
        status: 'in_progress',
      },
      { count: 'exact' }
    )
    .eq('id', parsed.data.audit_id)
  if (error) return { error: error.message }
  if ((count ?? 0) === 0) {
    return { error: 'Could not link the checklist to the audit (blocked by row security)' }
  }

  revalidateAudits(parsed.data.audit_id)
  return {}
}

// ─── Findings ─────────────────────────────────────────────────────────────────

export async function createFinding(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = findingCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { error: loadError, audit } = await loadAuditForWork(
    supabase,
    profile,
    parsed.data.audit_id
  )
  if (loadError || !audit) return { error: loadError ?? 'Audit not found' }
  if (audit.status === 'closed') {
    return { error: 'Cannot record findings against a closed audit' }
  }

  const { data: row, error } = await supabase
    .from('audit_findings')
    .insert({
      audit_id: parsed.data.audit_id,
      classification: parsed.data.classification,
      description: parsed.data.description,
      clause_ref: parsed.data.clause_ref,
      status: 'open',
      raised_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateAudits(parsed.data.audit_id)
  return { id: row.id }
}

async function loadFindingForWork(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: Profile,
  findingId: string
) {
  const { data: finding } = await supabase
    .from('audit_findings')
    .select(
      'id, audit_id, classification, status, ncr_id, audits(id, status, auditor_id)'
    )
    .eq('id', findingId)
    .single()
  if (!finding) return { error: 'Finding not found' as string, finding: null }

  const audit = finding.audits as unknown as {
    id: string
    status: string
    auditor_id: string | null
  } | null
  if (!audit) return { error: 'Audit not found' as string, finding: null }
  if (profile.role === 'supervisor' && audit.auditor_id !== profile.id) {
    return {
      error: 'Supervisors can only work on audits where they are the auditor',
      finding: null,
    }
  }
  return { error: null, finding: { ...finding, audit } }
}

export async function updateFinding(
  findingId: string,
  data: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = findingUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { error: loadError, finding } = await loadFindingForWork(
    supabase,
    profile,
    findingId
  )
  if (loadError || !finding) return { error: loadError ?? 'Finding not found' }
  if (finding.audit.status === 'closed') {
    return { error: 'Cannot edit findings on a closed audit' }
  }
  if (finding.status === 'closed') {
    return { error: 'Reopen the finding to edit it' }
  }

  const { error } = await supabase
    .from('audit_findings')
    .update(parsed.data)
    .eq('id', findingId)
  if (error) return { error: error.message }

  revalidateAudits(finding.audit_id as string)
  return {}
}

/**
 * Close a finding. A major_nc MUST have a linked NCR and that NCR must itself
 * be closed — the NCR close already enforces verification of effectiveness,
 * so this gate chains onto it rather than rebuilding it.
 */
export async function closeFinding(findingId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { error: loadError, finding } = await loadFindingForWork(
    supabase,
    profile,
    findingId
  )
  if (loadError || !finding) return { error: loadError ?? 'Finding not found' }
  if (finding.status === 'closed') return { error: 'Finding is already closed' }
  if (finding.audit.status === 'closed') {
    return { error: 'Cannot change findings on a closed audit' }
  }

  // ── Major-NC gate (NON-BYPASSABLE) ─────────────────────────────────────────
  let ncrStatus: string | null = null
  if (finding.ncr_id) {
    const { data: ncr } = await supabase
      .from('ncrs')
      .select('status')
      .eq('id', finding.ncr_id as string)
      .single()
    ncrStatus = (ncr?.status as string | null) ?? null
  }
  const gateError = findingCloseError({
    classification: finding.classification as 'observation' | 'minor_nc' | 'major_nc' | 'opportunity',
    ncr_id: (finding.ncr_id as string | null) ?? null,
    ncr_status: ncrStatus,
  })
  if (gateError) return { error: gateError }

  const { error } = await supabase
    .from('audit_findings')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', findingId)
  if (error) return { error: error.message }

  revalidateAudits(finding.audit_id as string)
  return {}
}

export async function reopenFinding(findingId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { error: loadError, finding } = await loadFindingForWork(
    supabase,
    profile,
    findingId
  )
  if (loadError || !finding) return { error: loadError ?? 'Finding not found' }
  if (finding.audit.status === 'closed') {
    return { error: 'Cannot change findings on a closed audit' }
  }

  const { error } = await supabase
    .from('audit_findings')
    .update({ status: 'open', closed_at: null })
    .eq('id', findingId)
  if (error) return { error: error.message }

  revalidateAudits(finding.audit_id as string)
  return {}
}

export async function deleteFinding(findingId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: finding } = await supabase
    .from('audit_findings')
    .select('id, audit_id, audits(status)')
    .eq('id', findingId)
    .single()
  if (!finding) return { error: 'Finding not found' }
  const audit = finding.audits as unknown as { status: string } | null
  if (audit?.status === 'closed') {
    return { error: 'Cannot delete findings on a closed audit' }
  }

  const { error } = await supabase.from('audit_findings').delete().eq('id', findingId)
  if (error) return { error: error.message }

  revalidateAudits(finding.audit_id as string)
  return {}
}

// ─── Raise an NCR from a finding ──────────────────────────────────────────────

/**
 * Escalate a finding into the NCR/CAPA register: creates the NCR with
 * source 'audit_finding' and links it back onto the finding. The NCR then
 * carries its own workflow (root cause → CAPA → verification → close), and the
 * finding cannot close (if major) until that NCR is closed.
 */
export async function raiseNcrFromFinding(
  data: unknown
): Promise<{ error?: string; ncrId?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = findingRaiseNcrSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { error: loadError, finding } = await loadFindingForWork(
    supabase,
    profile,
    parsed.data.finding_id
  )
  if (loadError || !finding) return { error: loadError ?? 'Finding not found' }
  if (finding.ncr_id) return { error: 'This finding already has a linked NCR' }
  if (finding.audit.status === 'closed') {
    return { error: 'Cannot raise an NCR from a finding on a closed audit' }
  }

  const number = await nextNumber(supabase, 'ncr').catch((err) => {
    throw new Error(`Failed to get next NCR number: ${err.message}`)
  })

  const { data: ncr, error: ncrError } = await supabase
    .from('ncrs')
    .insert({
      number,
      source: 'audit_finding',
      category: parsed.data.category,
      severity: parsed.data.severity,
      title: parsed.data.title,
      description: parsed.data.description,
      raised_by: profile.id,
      occurred_on: todayAU(),
      status: 'open',
    })
    .select('id')
    .single()
  if (ncrError) return { error: ncrError.message }

  const { error: linkError, count } = await supabase
    .from('audit_findings')
    .update({ ncr_id: ncr.id }, { count: 'exact' })
    .eq('id', parsed.data.finding_id)
  if (linkError) return { error: `NCR ${number} raised but linking failed: ${linkError.message}` }
  if ((count ?? 0) === 0) {
    return { error: `NCR ${number} raised but linking was blocked by row security` }
  }

  revalidateAudits(finding.audit_id as string)
  revalidatePath('/whs/ncr')
  return { ncrId: ncr.id }
}
