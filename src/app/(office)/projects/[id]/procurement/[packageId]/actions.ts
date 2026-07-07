'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import {
  packageAwardSchema,
  packageQuoteSchema,
  rfqSendSchema,
  rfqStatusSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidatePackage(projectId: string, packageId: string) {
  revalidatePath(`/projects/${projectId}/procurement/${packageId}`)
  revalidatePath(`/projects/${projectId}/procurement`)
  revalidatePath(`/projects/${projectId}/budget`)
  revalidatePath(`/projects/${projectId}`)
}

async function getPackage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageId: string,
  projectId: string
) {
  const { data } = await supabase
    .from('packages')
    .select('id, status, name, cost_code_id')
    .eq('id', packageId)
    .eq('project_id', projectId)
    .single()
  return data
}

// ─── Mark RFQ sent ────────────────────────────────────────────────────────────

export async function markRfqSent(
  packageId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = rfqSendSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const pkg = await getPackage(supabase, packageId, projectId)
  if (!pkg) return { error: 'Package not found' }

  // Skip vendors that already have an RFQ on this package
  const { data: existing } = await supabase
    .from('package_rfqs')
    .select('vendor_id')
    .eq('package_id', packageId)

  const existingIds = new Set((existing ?? []).map((r) => r.vendor_id))
  const newVendorIds = parsed.data.vendor_ids.filter((v) => !existingIds.has(v))

  if (newVendorIds.length > 0) {
    const { error } = await supabase.from('package_rfqs').insert(
      newVendorIds.map((vendor_id) => ({
        package_id: packageId,
        vendor_id,
        status: 'invited',
        email_snapshot: parsed.data.email_snapshot,
      }))
    )
    if (error) return { error: error.message }
  }

  // planned → rfq_out (only from planned)
  if (pkg.status === 'planned') {
    const { error } = await supabase
      .from('packages')
      .update({ status: 'rfq_out' })
      .eq('id', packageId)
    if (error) return { error: error.message }
  }

  revalidatePackage(projectId, packageId)
  return {}
}

// ─── RFQ status cycle ─────────────────────────────────────────────────────────

export async function setRfqStatus(
  rfqId: string,
  packageId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = rfqStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const pkg = await getPackage(supabase, packageId, projectId)
  if (!pkg) return { error: 'Package not found' }

  const { error } = await supabase
    .from('package_rfqs')
    .update({ status: parsed.data.status })
    .eq('id', rfqId)
    .eq('package_id', packageId)

  if (error) return { error: error.message }

  revalidatePackage(projectId, packageId)
  return {}
}

// ─── Upsert quote ─────────────────────────────────────────────────────────────

export async function upsertQuote(
  packageId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = packageQuoteSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const pkg = await getPackage(supabase, packageId, projectId)
  if (!pkg) return { error: 'Package not found' }

  // Vendor must have been invited (an RFQ row exists)
  const { data: rfq } = await supabase
    .from('package_rfqs')
    .select('id')
    .eq('package_id', packageId)
    .eq('vendor_id', parsed.data.vendor_id)
    .single()
  if (!rfq) return { error: 'Supplier has not been invited to this package' }

  const { error } = await supabase.from('package_quotes').upsert(
    {
      package_id: packageId,
      vendor_id: parsed.data.vendor_id,
      amount: parsed.data.amount,
      inclusions: parsed.data.inclusions,
      exclusions: parsed.data.exclusions,
      notes: parsed.data.notes,
      received_at: parsed.data.received_at,
    },
    { onConflict: 'package_id,vendor_id' }
  )
  if (error) return { error: error.message }

  // Auto: rfq → quoted
  const { error: rfqError } = await supabase
    .from('package_rfqs')
    .update({ status: 'quoted' })
    .eq('id', rfq.id)
  if (rfqError) return { error: rfqError.message }

  // Auto: package rfq_out → quotes_in on first quote
  if (pkg.status === 'rfq_out') {
    const { error: pkgError } = await supabase
      .from('packages')
      .update({ status: 'quotes_in' })
      .eq('id', packageId)
    if (pkgError) return { error: pkgError.message }
  }

  revalidatePackage(projectId, packageId)
  return {}
}

// ─── Recommend a quote ────────────────────────────────────────────────────────

export async function setRecommended(
  packageId: string,
  projectId: string,
  quoteId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const pkg = await getPackage(supabase, packageId, projectId)
  if (!pkg) return { error: 'Package not found' }
  if (pkg.status === 'awarded') {
    return { error: 'Package is already awarded' }
  }

  const { data: quote } = await supabase
    .from('package_quotes')
    .select('id')
    .eq('id', quoteId)
    .eq('package_id', packageId)
    .single()
  if (!quote) return { error: 'Quote not found' }

  // Clear other recommendations, then set this one
  const { error: clearError } = await supabase
    .from('package_quotes')
    .update({ recommended: false })
    .eq('package_id', packageId)
    .neq('id', quoteId)
  if (clearError) return { error: clearError.message }

  const { error: setError } = await supabase
    .from('package_quotes')
    .update({ recommended: true })
    .eq('id', quoteId)
  if (setError) return { error: setError.message }

  const { error: pkgError } = await supabase
    .from('packages')
    .update({ status: 'recommended' })
    .eq('id', packageId)
  if (pkgError) return { error: pkgError.message }

  revalidatePackage(projectId, packageId)
  return {}
}

// ─── Award package ────────────────────────────────────────────────────────────

export async function awardPackage(
  packageId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = packageAwardSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const pkg = await getPackage(supabase, packageId, projectId)
  if (!pkg) return { error: 'Package not found' }
  if (pkg.status === 'awarded') {
    return { error: 'Package is already awarded' }
  }

  // Vendor must have a quote on this package
  const { data: quote } = await supabase
    .from('package_quotes')
    .select('id')
    .eq('package_id', packageId)
    .eq('vendor_id', parsed.data.vendor_id)
    .single()
  if (!quote) return { error: 'Selected supplier has no quote on this package' }

  const { error: insertError } = await supabase.from('commitments').insert({
    project_id: projectId,
    kind: 'subcontract',
    vendor_id: parsed.data.vendor_id,
    package_id: packageId,
    cost_code_id: parsed.data.cost_code_id,
    budget_line_id: parsed.data.budget_line_id,
    description: parsed.data.description,
    amount: parsed.data.amount,
    status: 'active',
    date: todayAU(),
  })
  if (insertError) return { error: insertError.message }

  const { error: pkgError } = await supabase
    .from('packages')
    .update({ status: 'awarded' })
    .eq('id', packageId)
  if (pkgError) return { error: pkgError.message }

  revalidatePackage(projectId, packageId)
  return {}
}

// ─── Un-award (admin only) ────────────────────────────────────────────────────

export async function unawardPackage(
  packageId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const pkg = await getPackage(supabase, packageId, projectId)
  if (!pkg) return { error: 'Package not found' }
  if (pkg.status !== 'awarded') {
    return { error: 'Package is not awarded' }
  }

  const { error: deleteError } = await supabase
    .from('commitments')
    .delete()
    .eq('package_id', packageId)
    .eq('kind', 'subcontract')
  if (deleteError) return { error: deleteError.message }

  const { error: pkgError } = await supabase
    .from('packages')
    .update({ status: 'quotes_in' })
    .eq('id', packageId)
  if (pkgError) return { error: pkgError.message }

  revalidatePackage(projectId, packageId)
  return {}
}
