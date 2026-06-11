'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { packageCreateSchema, packageUpdateSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateProcurement(projectId: string) {
  revalidatePath(`/projects/${projectId}/procurement`)
  revalidatePath(`/projects/${projectId}/budget`)
  revalidatePath(`/projects/${projectId}`)
}

// ─── Create package ───────────────────────────────────────────────────────────

export async function createPackage(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = packageCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', parsed.data.project_id)
    .single()
  if (!project) return { error: 'Project not found' }

  const { data: row, error } = await supabase
    .from('packages')
    .insert({
      project_id: parsed.data.project_id,
      name: parsed.data.name,
      budget_amount: parsed.data.budget_amount ?? 0,
      cost_code_id: parsed.data.cost_code_id ?? null,
      owner_id: parsed.data.owner_id ?? null,
      let_by_date: parsed.data.let_by_date ?? null,
      notes: parsed.data.notes ?? null,
      status: 'planned',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateProcurement(parsed.data.project_id)
  return { id: row.id }
}

// ─── Update package ───────────────────────────────────────────────────────────

export async function updatePackage(
  packageId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = packageUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: pkg } = await supabase
    .from('packages')
    .select('id, status')
    .eq('id', packageId)
    .eq('project_id', projectId)
    .single()
  if (!pkg) return { error: 'Package not found' }

  const { error } = await supabase
    .from('packages')
    .update(parsed.data)
    .eq('id', packageId)

  if (error) return { error: error.message }

  revalidateProcurement(projectId)
  return {}
}

// ─── Delete package ───────────────────────────────────────────────────────────

export async function deletePackage(
  packageId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: pkg } = await supabase
    .from('packages')
    .select('id, status')
    .eq('id', packageId)
    .eq('project_id', projectId)
    .single()
  if (!pkg) return { error: 'Package not found' }

  if (pkg.status !== 'planned') {
    return { error: 'Only planned packages with no RFQs can be deleted' }
  }

  // Check no RFQs exist
  const { count } = await supabase
    .from('package_rfqs')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId)

  if ((count ?? 0) > 0) {
    return { error: 'Cannot delete a package that has RFQs' }
  }

  const { error } = await supabase
    .from('packages')
    .delete()
    .eq('id', packageId)

  if (error) return { error: error.message }

  revalidateProcurement(projectId)
  return {}
}
