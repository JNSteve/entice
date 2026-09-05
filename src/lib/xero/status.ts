import { createAdminClient } from '@/lib/supabase/server'
import { xeroConfigured } from './config'
import { loadConnection } from './tokens'

export type XeroStatus = {
  /** Env + service role present — the integration can run at all. */
  available: boolean
  reason: string | null
  connected: boolean
  status: 'connected' | 'needs_reconnect' | 'disconnected' | 'unavailable'
  tenantName: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  lastSyncStatus: string | null
  /** Tokens exist for a different org than before — awaiting typed confirmation. */
  pendingOrgSwitch: { tenantName: string } | null
}

const UNAVAILABLE: XeroStatus = {
  available: false,
  reason: null,
  connected: false,
  status: 'unavailable',
  tenantName: null,
  connectedAt: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  pendingOrgSwitch: null,
}

/**
 * Page-safe connection summary. Never throws, never returns token material.
 * Used by Settings, the invoice page, Money, the dashboard and the cron.
 */
export async function getXeroStatus(): Promise<XeroStatus> {
  if (!xeroConfigured()) {
    return { ...UNAVAILABLE, reason: 'XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_TOKEN_KEY must be set in the environment.' }
  }
  let admin
  try {
    admin = createAdminClient()
  } catch {
    return { ...UNAVAILABLE, reason: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment.' }
  }
  try {
    const row = await loadConnection(admin)
    if (!row) return { ...UNAVAILABLE, available: true, status: 'disconnected' }
    const hasTokens = Boolean(row.refresh_token_enc)
    return {
      available: true,
      reason: null,
      connected: row.status === 'connected' && hasTokens,
      status: row.status,
      tenantName: row.tenant_name,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      pendingOrgSwitch:
        row.status === 'needs_reconnect' && hasTokens && row.tenant_name
          ? { tenantName: row.tenant_name }
          : null,
    }
  } catch (err) {
    return { ...UNAVAILABLE, available: true, reason: err instanceof Error ? err.message : String(err) }
  }
}
