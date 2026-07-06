'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { todayAU } from '@/lib/tz'
import {
  itpAdoptSchema,
  lotCreateSchema,
  lotInspectionSchema,
  lotRaiseNcrSchema,
  lotTestResultSchema,
} from '@/lib/zod'
import {
  holdPointItems,
  lotCloseError,
  unresolvedFailureCount,
  type LotFailureCheck,
} from '@/lib/lot-gates'

type Result = { error?: string }

function revalidateQuality(projectId: string, lotId?: string) {
  revalidatePath(`/projects/${projectId}/quality`)
  if (lotId) revalidatePath(`/projects/${projectId}/quality/lots/${lotId}`)
}

type Db = Awaited<ReturnType<typeof createClient>>

// ─── Adopt an ITP template onto a project ─────────────────────────────────────

/**
 * Copies the template's items into a new instance (ITP-xxxx). Template rows
 * are COPIED at adoption — editing the template later never silently changes
 * an in-flight ITP (a new revision needs a deliberate re-adoption).
 */
export async function adoptItp(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = itpAdoptSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const [{ data: project }, { data: template }, { data: items }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('id')
        .eq('id', parsed.data.project_id)
        .single(),
      supabase
        .from('itp_templates')
        .select('id, name, activity, active')
        .eq('id', parsed.data.template_id)
        .single(),
      supabase
        .from('itp_template_items')
        .select(
          'position, description, acceptance_criteria, spec_ref, point_type, record_required, responsible'
        )
        .eq('template_id', parsed.data.template_id)
        .order('position'),
    ])

  if (!project) return { error: 'Project not found' }
  if (!template) return { error: 'ITP template not found' }
  if (!template.active) return { error: 'That ITP template is inactive' }
  if (!items || items.length === 0) {
    return { error: 'That ITP template has no items — build it in Settings first' }
  }

  const number = await nextNumber(supabase, 'itp')

  const { data: instance, error: insError } = await supabase
    .from('itp_instances')
    .insert({
      number,
      project_id: parsed.data.project_id,
      template_id: parsed.data.template_id,
      title: template.name,
      activity: template.activity,
      adopted_by: profile.id,
    })
    .select('id')
    .single()
  if (insError) return { error: insError.message }

  const { error: itemsError } = await supabase.from('itp_instance_items').insert(
    items.map((i) => ({
      instance_id: instance.id,
      position: i.position,
      description: i.description,
      acceptance_criteria: i.acceptance_criteria,
      spec_ref: i.spec_ref ?? null,
      point_type: i.point_type,
      record_required: i.record_required,
      responsible: i.responsible ?? null,
    }))
  )
  if (itemsError) {
    // Roll back the shell so a half-adopted ITP never lingers.
    await supabase.from('itp_instances').delete().eq('id', instance.id)
    return { error: itemsError.message }
  }

  revalidateQuality(parsed.data.project_id)
  return { id: instance.id }
}

// ─── Lots ─────────────────────────────────────────────────────────────────────

/**
 * Creates a lot against an adopted ITP and raises a quality hold point for
 * every hold-type ITP item (excluding N/A) — work cannot be accepted past a
 * hold point until it is released through the shared release flow.
 */
export async function createLot(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = lotCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: instance } = await supabase
    .from('itp_instances')
    .select('id, project_id, status')
    .eq('id', parsed.data.itp_instance_id)
    .eq('project_id', parsed.data.project_id)
    .single()
  if (!instance) return { error: 'ITP instance not found on this project' }
  if (instance.status !== 'active') {
    return { error: 'That ITP instance is closed' }
  }

  const { data: items } = await supabase
    .from('itp_instance_items')
    .select('id, description, point_type, status, responsible')
    .eq('instance_id', instance.id)
    .order('position')

  const number = await nextNumber(supabase, 'lot')

  const { data: lot, error: lotError } = await supabase
    .from('lots')
    .insert({
      number,
      project_id: parsed.data.project_id,
      itp_instance_id: instance.id,
      description: parsed.data.description,
      location: parsed.data.location ?? null,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (lotError) return { error: lotError.message }

  // Quality hold points — one per hold-type ITP item, released via the same
  // flow as programme hold points (origin 'quality', lot context).
  const holds = holdPointItems(items ?? [])
  if (holds.length > 0) {
    const { error: hpError } = await supabase.from('hold_points').insert(
      holds.map((h) => ({
        project_id: parsed.data.project_id,
        origin: 'quality',
        lot_id: lot.id,
        itp_instance_item_id: h.id,
        title: `${number} — ${h.description}`,
        required_by: h.responsible ?? 'Superintendent',
        date: todayAU(),
      }))
    )
    if (hpError) {
      await supabase.from('lots').delete().eq('id', lot.id)
      return { error: `Lot not created — hold points failed: ${hpError.message}` }
    }
  }

  revalidateQuality(parsed.data.project_id, lot.id)
  return { id: lot.id }
}

// ─── Inspections ──────────────────────────────────────────────────────────────

/**
 * Records a pass/fail inspection of one ITP item for a lot, and mirrors the
 * result onto the instance item (checked by/at) so the ITP checklist reads
 * live. Conformance/status recompute in the DB (sync triggers).
 */
export async function recordInspection(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = lotInspectionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: lot } = await supabase
    .from('lots')
    .select('id, project_id, status, itp_instance_id')
    .eq('id', parsed.data.lot_id)
    .single()
  if (!lot) return { error: 'Lot not found' }
  if (lot.status === 'closed') {
    return { error: 'Cannot record inspections on a closed lot' }
  }

  const { data: item } = await supabase
    .from('itp_instance_items')
    .select('id, status, instance_id')
    .eq('id', parsed.data.itp_instance_item_id)
    .eq('instance_id', lot.itp_instance_id)
    .single()
  if (!item) return { error: 'ITP item not found on this lot’s ITP' }
  if (item.status === 'na') {
    return { error: 'That ITP item is marked N/A' }
  }

  const { data: row, error } = await supabase
    .from('lot_inspections')
    .insert({
      lot_id: lot.id,
      itp_instance_item_id: item.id,
      result: parsed.data.result,
      notes: parsed.data.notes ?? null,
      inspected_by: profile.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Mirror onto the instance checklist (latest result wins).
  await supabase
    .from('itp_instance_items')
    .update({
      status: parsed.data.result === 'pass' ? 'passed' : 'failed',
      checked_by: profile.id,
      checked_at: new Date().toISOString(),
      notes: parsed.data.notes ?? null,
    })
    .eq('id', item.id)

  revalidateQuality(lot.project_id, lot.id)
  return { id: row.id }
}

/** Strike an ITP instance item out as N/A (or back to pending). Admin/office
 *  only — marking N/A also withdraws any unreleased quality hold points the
 *  item raised, which needs the hold-point delete permission. */
export async function setItpItemNa(
  itemId: string,
  projectId: string,
  na: boolean
): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: item } = await supabase
    .from('itp_instance_items')
    .select('id, status, instance_id, itp_instances!inner(project_id)')
    .eq('id', itemId)
    .eq('itp_instances.project_id', projectId)
    .single()
  if (!item) return { error: 'ITP item not found' }

  if (na && item.status !== 'pending') {
    return { error: 'Only a pending item can be marked N/A' }
  }
  if (!na && item.status !== 'na') {
    return { error: 'Only an N/A item can be restored to pending' }
  }

  const { error } = await supabase
    .from('itp_instance_items')
    .update({
      status: na ? 'na' : 'pending',
      checked_by: profile.id,
      checked_at: new Date().toISOString(),
    })
    .eq('id', itemId)
  if (error) return { error: error.message }

  if (na) {
    // Withdraw unreleased quality hold points raised from this item so lots
    // cannot dead-end on an inspection that no longer applies.
    const { error: hpError } = await supabase
      .from('hold_points')
      .delete()
      .eq('itp_instance_item_id', itemId)
      .neq('status', 'released')
    if (hpError) return { error: hpError.message }
  }

  revalidateQuality(projectId)
  return {}
}

// ─── Test results ─────────────────────────────────────────────────────────────

export async function addTestResult(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = lotTestResultSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: lot } = await supabase
    .from('lots')
    .select('id, project_id, status')
    .eq('id', parsed.data.lot_id)
    .single()
  if (!lot) return { error: 'Lot not found' }
  if (lot.status === 'closed') {
    return { error: 'Cannot record test results on a closed lot' }
  }

  const { data: row, error } = await supabase
    .from('lot_test_results')
    .insert({
      lot_id: lot.id,
      test_type: parsed.data.test_type,
      description: parsed.data.description,
      value: parsed.data.value,
      uom: parsed.data.uom ?? null,
      spec_min: parsed.data.spec_min,
      spec_max: parsed.data.spec_max,
      pass: parsed.data.pass,
      lab_ref: parsed.data.lab_ref ?? null,
      tested_on: parsed.data.tested_on,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateQuality(lot.project_id, lot.id)
  return { id: row.id }
}

// ─── Raise an NCR from a failure ──────────────────────────────────────────────

/**
 * Raises a linked NCR (source 'itp') from a failed inspection or test.
 * The lot cannot close until that NCR is driven through its full workflow to
 * a verified close — the same non-bypassable gate the audit module uses.
 */
export async function raiseNcrFromLot(
  data: unknown
): Promise<{ error?: string; ncrId?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = lotRaiseNcrSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const table = parsed.data.kind === 'inspection' ? 'lot_inspections' : 'lot_test_results'

  const { data: record } = await supabase
    .from(table)
    .select('id, lot_id, ncr_id, lots!inner(id, project_id, status)')
    .eq('id', parsed.data.record_id)
    .single()
  if (!record) return { error: 'Record not found' }
  if (record.ncr_id) return { error: 'This failure already has a linked NCR' }

  const lot = record.lots as unknown as {
    id: string
    project_id: string
    status: string
  }
  if (lot.status === 'closed') {
    return { error: 'Cannot raise an NCR from a closed lot' }
  }

  const number = await nextNumber(supabase, 'ncr')

  const { data: ncr, error: ncrError } = await supabase
    .from('ncrs')
    .insert({
      number,
      source: 'itp',
      category: parsed.data.category,
      severity: parsed.data.severity,
      title: parsed.data.title,
      description: parsed.data.description,
      project_id: lot.project_id,
      raised_by: profile.id,
      occurred_on: todayAU(),
      status: 'open',
    })
    .select('id')
    .single()
  if (ncrError) return { error: ncrError.message }

  const { error: linkError, count } = await supabase
    .from(table)
    .update({ ncr_id: ncr.id }, { count: 'exact' })
    .eq('id', parsed.data.record_id)
  if (linkError) {
    return { error: `NCR ${number} raised but linking failed: ${linkError.message}` }
  }
  if ((count ?? 0) === 0) {
    return { error: `NCR ${number} raised but linking was blocked by row security` }
  }

  revalidateQuality(lot.project_id, lot.id)
  revalidatePath('/whs/ncr')
  return { ncrId: ncr.id }
}

// ─── Close / reopen ───────────────────────────────────────────────────────────

/** Loads the gate counts for a lot (shared by closeLot and the detail page). */
async function loadLotGateCounts(supabase: Db, lotId: string, instanceId: string) {
  const [{ data: holdPoints }, { data: inspections }, { data: tests }, { data: items }] =
    await Promise.all([
      supabase
        .from('hold_points')
        .select('id, status')
        .eq('lot_id', lotId)
        .neq('status', 'released'),
      supabase
        .from('lot_inspections')
        .select('id, itp_instance_item_id, result, ncr_id, ncrs(status)')
        .eq('lot_id', lotId),
      supabase
        .from('lot_test_results')
        .select('id, pass, ncr_id, ncrs(status)')
        .eq('lot_id', lotId),
      supabase
        .from('itp_instance_items')
        .select('id, status, record_required')
        .eq('instance_id', instanceId),
    ])

  const failures: LotFailureCheck[] = [
    ...(inspections ?? [])
      .filter((i) => i.result === 'fail')
      .map((i) => ({
        ncr_id: (i.ncr_id as string | null) ?? null,
        ncr_status: (i.ncrs as unknown as { status: string } | null)?.status ?? null,
      })),
    ...(tests ?? [])
      .filter((t) => t.pass === false)
      .map((t) => ({
        ncr_id: (t.ncr_id as string | null) ?? null,
        ncr_status: (t.ncrs as unknown as { status: string } | null)?.status ?? null,
      })),
  ]

  const passedItemIds = new Set(
    (inspections ?? [])
      .filter((i) => i.result === 'pass')
      .map((i) => i.itp_instance_item_id as string)
  )
  const missingRecordCount = (items ?? []).filter(
    (i) => i.status !== 'na' && i.record_required && !passedItemIds.has(i.id as string)
  ).length

  return {
    openHoldPointCount: (holdPoints ?? []).length,
    unresolvedFailureCount: unresolvedFailureCount(failures),
    missingRecordCount,
  }
}

/**
 * Close gate (non-bypassable): no unreleased hold points, no failure without
 * a linked CLOSED NCR, every record-required item passed. Belt-and-braces:
 * the SQL fn lot_conformance() must also agree the lot is conforming.
 */
export async function closeLot(lotId: string, projectId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { data: lot } = await supabase
    .from('lots')
    .select('id, status, itp_instance_id')
    .eq('id', lotId)
    .eq('project_id', projectId)
    .single()
  if (!lot) return { error: 'Lot not found' }
  if (lot.status === 'closed') return { error: 'Lot is already closed' }

  const counts = await loadLotGateCounts(supabase, lotId, lot.itp_instance_id as string)
  const gateError = lotCloseError(counts)
  if (gateError) return { error: gateError }

  // The database's own verdict must agree (conformance is computed, not
  // hand-set) — a mismatch means stale data, so refuse rather than guess.
  const { data: verdict, error: fnError } = await supabase.rpc('lot_conformance', {
    p_lot: lotId,
  })
  if (fnError) return { error: fnError.message }
  if (verdict !== 'conforming') {
    return { error: `Cannot close — conformance check returned '${verdict}'` }
  }

  const { error } = await supabase
    .from('lots')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: profile.id,
    })
    .eq('id', lotId)
  if (error) return { error: error.message }

  revalidateQuality(projectId, lotId)
  return {}
}

/** Admin-only reopen — status returns to the COMPUTED conformance value. */
export async function reopenLot(lotId: string, projectId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  if (profile.role !== 'admin') {
    return { error: 'Only an admin can reopen a closed lot' }
  }

  const supabase = await createClient()

  const { data: lot } = await supabase
    .from('lots')
    .select('id, status')
    .eq('id', lotId)
    .eq('project_id', projectId)
    .single()
  if (!lot) return { error: 'Lot not found' }
  if (lot.status !== 'closed') return { error: 'Only a closed lot can be reopened' }

  const { data: verdict, error: fnError } = await supabase.rpc('lot_conformance', {
    p_lot: lotId,
  })
  if (fnError) return { error: fnError.message }

  const { error } = await supabase
    .from('lots')
    .update({
      status: (verdict as string) ?? 'open',
      closed_at: null,
      closed_by: null,
    })
    .eq('id', lotId)
  if (error) return { error: error.message }

  revalidateQuality(projectId, lotId)
  return {}
}
