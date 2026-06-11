'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/money'
import { retentionReleaseSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateRetention(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/claims`)
}

// ─── Record retention release ─────────────────────────────────────────────────

export async function recordRetentionRelease(
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = retentionReleaseSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Verify project exists
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()
  if (!project) return { error: 'Project not found' }

  // Server-side recompute of currently held retention
  const { data: entries } = await supabase
    .from('retention_entries')
    .select('kind, amount')
    .eq('project_id', projectId)

  const currentlyHeld = round2(
    (entries ?? []).reduce(
      (s, e) =>
        e.kind === 'withheld' ? s + Number(e.amount) : s - Number(e.amount),
      0
    )
  )

  if (parsed.data.amount <= 0) {
    return { error: 'Amount must be greater than zero' }
  }

  if (parsed.data.amount > currentlyHeld) {
    return {
      error: `Release amount (${parsed.data.amount}) exceeds currently held retention (${currentlyHeld})`,
    }
  }

  const { error } = await supabase.from('retention_entries').insert({
    project_id: projectId,
    claim_id: null,
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    date: parsed.data.date,
    notes: parsed.data.notes ?? null,
  })
  if (error) return { error: error.message }

  revalidateRetention(projectId)
  return {}
}
