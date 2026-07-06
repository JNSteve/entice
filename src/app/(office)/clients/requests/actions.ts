'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { notifyClientRequestStatus } from '@/lib/notify'
import {
  canConvertRequest,
  canTransitionRequest,
} from '@/lib/portal-interactions'
import { portalRequestStatusSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateRequests(clientId?: string, siteId?: string) {
  revalidatePath('/clients/requests')
  revalidatePath('/')
  if (clientId) revalidatePath(`/clients/${clientId}`)
  if (clientId && siteId) revalidatePath(`/clients/${clientId}/sites/${siteId}`)
}

/**
 * Moves a portal work request along its lifecycle (forward-only; declining is
 * allowed while open — see REQUEST_TRANSITIONS in lib/portal-interactions).
 */
export async function setRequestStatus(id: string, data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = portalRequestStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: request } = await supabase
    .from('portal_requests')
    .select('id, status, client_id, site_id')
    .eq('id', id)
    .single()
  if (!request) return { error: 'Request not found' }

  if (!canTransitionRequest(request.status, parsed.data.status)) {
    return {
      error: `Can't move a ${request.status} request to ${parsed.data.status}`,
    }
  }

  const { error } = await supabase
    .from('portal_requests')
    .update({ status: parsed.data.status, handled_by: profile.id })
    .eq('id', id)
  if (error) return { error: error.message }

  // Client email — fire-and-forget AFTER the response (never blocking).
  const newStatus = parsed.data.status
  after(() => notifyClientRequestStatus({ requestId: id, status: newStatus }))

  revalidateRequests(request.client_id, request.site_id)
  return {}
}

/**
 * Convert-to-quote: creates a draft quote pre-filled from the request
 * (client, site, title; the client's description lands in the quote notes
 * with the REQ reference), links it via quote_id and flips the request to
 * 'quoted'. Guarded against double conversion.
 */
export async function convertRequestToQuote(
  id: string
): Promise<{ error?: string; quoteId?: string }> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: request } = await supabase
    .from('portal_requests')
    .select('id, number, status, quote_id, client_id, site_id, title, description')
    .eq('id', id)
    .single()
  if (!request) return { error: 'Request not found' }

  if (!canConvertRequest(request.status, request.quote_id)) {
    return {
      error: request.quote_id
        ? 'This request already has a quote'
        : `A ${request.status} request can no longer be converted`,
    }
  }

  // GST rate snapshot from company settings (falls back to the column default).
  const { data: settings } = await supabase
    .from('settings')
    .select('gst_rate')
    .eq('id', 1)
    .single()

  let number: string
  try {
    number = await nextNumber(supabase, 'quote')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate quote number' }
  }

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .insert({
      number,
      client_id: request.client_id,
      site_id: request.site_id,
      title: request.title,
      notes: `From portal request ${request.number}:\n\n${request.description}`,
      gst_rate: settings?.gst_rate ?? 10,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (quoteError || !quote) {
    return { error: quoteError?.message ?? 'Failed to create quote' }
  }

  const { error: linkError } = await supabase
    .from('portal_requests')
    .update({ quote_id: quote.id, status: 'quoted', handled_by: profile.id })
    .eq('id', id)
  if (linkError) return { error: linkError.message }

  // Client email — fire-and-forget AFTER the response (never blocking).
  after(() => notifyClientRequestStatus({ requestId: id, status: 'quoted' }))

  revalidateRequests(request.client_id, request.site_id)
  revalidatePath('/quotes')
  return { quoteId: quote.id }
}
