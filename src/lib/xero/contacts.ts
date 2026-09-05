import type { XeroApi } from './client'
import { ifModifiedSinceHeader, matchContactToClient, normaliseAbn, type ClientForMatch } from './map'
import { logEvent, type Admin } from './register'
import type { XeroContact } from './types'

const PAGE = 100

/**
 * Contacts (spec §3 / §5.5). We cache ONLY contact_id, name, abn, has_email.
 * Auto-link: ABN, then exact name; ambiguous → left for the manual picker.
 */
export async function syncContacts(
  admin: Admin,
  api: XeroApi,
  runId: string,
  since: string | null
): Promise<{ cached: number; linked: number }> {
  const now = new Date().toISOString()
  const all: XeroContact[] = []
  for (let page = 1; ; page++) {
    const path = `/Contacts?page=${page}`
    const { Contacts = [] } = await api.get<{ Contacts?: XeroContact[] }>(
      path,
      since ? { headers: { 'If-Modified-Since': ifModifiedSinceHeader(since) } } : undefined
    )
    all.push(...Contacts)
    if (Contacts.length < PAGE) break
  }

  if (all.length > 0) {
    const rows = all.map((c) => ({
      contact_id: c.ContactID,
      name: c.Name,
      abn: normaliseAbn(c.TaxNumber),
      has_email: Boolean(c.EmailAddress?.trim()),
      status: c.ContactStatus ?? 'ACTIVE',
      synced_at: now,
    }))
    const { error } = await admin.from('xero_contacts').upsert(rows, { onConflict: 'contact_id' })
    if (error) throw new Error(`contacts cache: ${error.message}`)
  }

  const { data: clients } = await admin
    .from('clients')
    .select('id, name, abn')
    .is('xero_contact_id', null)
    .eq('archived', false)
  const unlinked = (clients ?? []) as ClientForMatch[]
  let linked = 0
  for (const c of all) {
    if (c.ContactStatus === 'ARCHIVED') continue
    const clientId = matchContactToClient(c, unlinked)
    if (!clientId) continue
    const { error } = await admin
      .from('clients')
      .update({ xero_contact_id: c.ContactID })
      .eq('id', clientId)
      .is('xero_contact_id', null)
    if (error) continue
    linked++
    const idx = unlinked.findIndex((u) => u.id === clientId)
    if (idx >= 0) unlinked.splice(idx, 1)
    await logEvent(admin, runId, {
      direction: 'pull', entity: 'contact', entityId: clientId, xeroId: c.ContactID,
      action: 'matched', detail: `Linked client to Xero contact "${c.Name}"`,
    })
  }
  return { cached: all.length, linked }
}

/**
 * Resolve (or create) the Xero contact for a client. Creation sends name, ABN
 * and the primary contact's email only (spec §3 "writes").
 */
export async function ensureContactForClient(
  admin: Admin,
  api: XeroApi,
  runId: string,
  clientId: string
): Promise<string> {
  const { data: client, error } = await admin
    .from('clients')
    .select('id, name, abn, xero_contact_id')
    .eq('id', clientId)
    .single()
  if (error || !client) throw new Error('Client not found')
  if (client.xero_contact_id) return client.xero_contact_id as string

  // Search Xero by ABN, then exact name.
  const abn = normaliseAbn(client.abn as string | null)
  const candidates: XeroContact[] = []
  if (abn) {
    const { Contacts = [] } = await api.get<{ Contacts?: XeroContact[] }>(
      `/Contacts?where=${encodeURIComponent(`TaxNumber=="${abn}"`)}`
    )
    candidates.push(...Contacts)
  }
  if (candidates.length === 0) {
    const { Contacts = [] } = await api.get<{ Contacts?: XeroContact[] }>(
      `/Contacts?where=${encodeURIComponent(
        // Backslashes first, or escaping the quotes would double-escape them.
        `Name=="${(client.name as string).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      )}`
    )
    candidates.push(...Contacts)
  }
  let contactId: string
  let hasEmail = false
  if (candidates.length > 1) {
    throw new Error(
      `Several Xero contacts match "${client.name}" — link the right one in Settings → Xero, then send again.`
    )
  }
  if (candidates.length >= 1) {
    contactId = candidates[0].ContactID
    hasEmail = Boolean(candidates[0].EmailAddress?.trim())
    await logEvent(admin, runId, {
      direction: 'push', entity: 'contact', entityId: clientId, xeroId: contactId,
      action: 'matched', detail: `Found existing Xero contact "${candidates[0].Name}"`,
    })
  } else {
    const { data: contacts } = await admin
      .from('contacts')
      .select('email')
      .eq('client_id', clientId)
      .not('email', 'is', null)
      .order('name')
      .limit(1)
    const email = (contacts?.[0]?.email as string | undefined)?.trim() || undefined
    const created = await api.post<{ Contacts: XeroContact[] }>('/Contacts', {
      Contacts: [{ Name: client.name, ...(abn ? { TaxNumber: abn } : {}), ...(email ? { EmailAddress: email } : {}) }],
    })
    contactId = created.Contacts[0].ContactID
    hasEmail = Boolean(email)
    await logEvent(admin, runId, {
      direction: 'push', entity: 'contact', entityId: clientId, xeroId: contactId,
      action: 'created', detail: `Created Xero contact "${client.name}"${email ? '' : ' (no email on file)'}`,
    })
  }

  await admin.from('clients').update({ xero_contact_id: contactId }).eq('id', clientId)
  await admin.from('xero_contacts').upsert(
    { contact_id: contactId, name: client.name, abn, has_email: hasEmail, status: 'ACTIVE', synced_at: new Date().toISOString() },
    { onConflict: 'contact_id' }
  )
  return contactId
}
