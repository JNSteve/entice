'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { officePortalMessageSchema } from '@/lib/zod'

/**
 * Office side of the portal correspondence thread (portal_messages).
 * Admin/office only — RLS additionally enforces sender='office' with the
 * caller's own profile id on INSERT, and a trigger freezes everything but the
 * read flags on UPDATE.
 */

export async function sendOfficeMessage(data: unknown): Promise<{ error?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = officePortalMessageSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // The site must belong to the client — the pair anchors the thread.
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', parsed.data.site_id)
    .eq('client_id', parsed.data.client_id)
    .single()
  if (!site) return { error: 'Site not found for this client' }

  const { error } = await supabase.from('portal_messages').insert({
    client_id: parsed.data.client_id,
    site_id: parsed.data.site_id,
    sender: 'office',
    sender_profile_id: profile.id,
    body: parsed.data.body,
    read_by_office: true,
    read_by_client: false,
  })
  if (error) return { error: error.message }

  revalidatePath(`/clients/${parsed.data.client_id}/sites/${parsed.data.site_id}`)
  return {}
}

/** Marks the client's messages on this thread as read (thread opened). */
export async function markThreadRead(
  clientId: string,
  siteId: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('portal_messages')
    .update({ read_by_office: true })
    .eq('client_id', clientId)
    .eq('site_id', siteId)
    .eq('sender', 'client')
    .eq('read_by_office', false)
  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}/sites/${siteId}`)
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/')
  return {}
}
