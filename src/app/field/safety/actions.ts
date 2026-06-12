'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formSignonSchema } from '@/lib/zod'

/**
 * Adds a sign-on row to a form submission that requires sign-on
 * (toolbox attendance, inductions).
 *
 * - self = true  → the signed-in user signing for themselves (profile_id me).
 * - self = false → pass-the-phone: someone without a login signs on this
 *   device (profile_id null). RLS limits this to admin/office/supervisor.
 */
export async function addFormSignon(input: unknown): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = formSignonSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: submission } = await supabase
    .from('form_submissions')
    .select('id, form_templates(requires_signon)')
    .eq('id', parsed.data.submission_id)
    .single()
  if (!submission) return { error: 'Submission not found' }

  const tpl = submission.form_templates as unknown as {
    requires_signon: boolean
  } | null
  if (!tpl?.requires_signon) {
    return { error: 'This form does not collect sign-ons' }
  }

  if (parsed.data.self) {
    const { data: existing } = await supabase
      .from('form_signons')
      .select('id')
      .eq('submission_id', parsed.data.submission_id)
      .eq('profile_id', profile.id)
      .maybeSingle()
    if (existing) return { error: 'You have already signed on' }
  }

  const { error } = await supabase.from('form_signons').insert({
    submission_id: parsed.data.submission_id,
    profile_id: parsed.data.self ? profile.id : null,
    name: parsed.data.name,
    company: parsed.data.company ?? null,
    signature_data: parsed.data.signature,
  })
  if (error) {
    if (error.code === '42501') {
      return {
        error:
          'Only supervisors and office staff can record sign-ons for others on this device',
      }
    }
    return { error: error.message }
  }

  revalidatePath(`/field/safety/submission/${parsed.data.submission_id}`)
  return {}
}
