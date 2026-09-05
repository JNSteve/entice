'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2Icon, Link2Icon, RefreshCwIcon, TriangleAlertIcon, UnplugIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RATE_KINDS, type RateKind } from '@/lib/zod'
import type { XeroStatus } from '@/lib/xero/status'
import { cn } from '@/lib/utils'
import {
  confirmXeroOrgSwitch,
  disconnectXero,
  linkClientToXeroContact,
  retryClaimPush,
  saveXeroMapping,
  syncXeroNow,
} from './xero-actions'

export interface XeroAccountRow { code: string; name: string; type: string; status: string | null }
export interface XeroTaxRateRow { tax_type: string; name: string; effective_rate: number | null }
export interface XeroTrackingCategoryRow { id: string; name: string; status: string | null }
export interface XeroContactRow { contact_id: string; name: string; abn: string | null; has_email: boolean }
export interface UnlinkedClientRow { id: string; name: string; abn: string | null }
export interface PendingClaimRow { id: string; project_id: string; project_number: string; number: number; certified_amount: number | null }
export interface XeroRunRow {
  id: string; started_at: string; finished_at: string | null; status: string; trigger: string
  invoices_pulled: number; invoices_created: number; payments_upserted: number; contacts_linked: number
  pushed: number; warnings: number; errors: number; error: string | null
}
export interface XeroEventRow {
  id: string; created_at: string; direction: string; entity: string; action: string; detail: string | null; xero_id: string | null
}
export interface XeroMappingRow {
  xero_email_mode: 'xero' | 'ecr'
  xero_default_account: string | null
  xero_account_by_kind: Record<string, string>
  xero_claims_account: string | null
  xero_gst_tax_type: string
  xero_no_gst_tax_type: string
  xero_tracking_category_id: string | null
}

export interface XeroSectionProps {
  status: XeroStatus
  flag: string | null
  mapping: XeroMappingRow
  accounts: XeroAccountRow[]
  taxRates: XeroTaxRateRow[]
  trackingCategories: XeroTrackingCategoryRow[]
  contacts: XeroContactRow[]
  unlinkedClients: UnlinkedClientRow[]
  pendingClaims: PendingClaimRow[]
  runs: XeroRunRow[]
  events: XeroEventRow[]
  isAdmin: boolean
}

const KIND_LABELS: Record<RateKind, string> = {
  labour: 'Labour', plant: 'Plant', material: 'Materials', subbie: 'Subcontract', other: 'Other',
}
const NONE = '__none__'

const FLAG_COPY: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'Connected to Xero. Run a sync to load accounts, tax rates and contacts.' },
  switched: { tone: 'warn', text: 'This is a different Xero organisation than before. Confirm below to clear the old links.' },
  denied: { tone: 'warn', text: 'Xero access was declined.' },
  state: { tone: 'warn', text: 'The connection attempt could not be verified (state mismatch or expired). Try again.' },
  failed: { tone: 'warn', text: 'Xero did not complete the connection. Check the Client id / secret in Vercel and try again.' },
  multitenant: { tone: 'warn', text: 'You approved more than one organisation. Disconnect the extras in Xero (Settings → Connected apps) and connect again with just one.' },
  notenant: { tone: 'warn', text: 'No organisation was authorised.' },
  unconfigured: { tone: 'warn', text: 'XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_TOKEN_KEY are missing from the environment.' },
  noservicerole: { tone: 'warn', text: 'SUPABASE_SERVICE_ROLE_KEY is missing — the connection cannot be stored.' },
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'short', timeStyle: 'short' })
}

export function XeroSection(p: XeroSectionProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const flag = p.flag ? FLAG_COPY[p.flag] : null

  function run(fn: () => Promise<{ error?: string; summary?: string }>, ok: string) {
    start(async () => {
      const r = await fn()
      if (r.error) toast.error(r.error)
      else toast.success(r.summary ?? ok)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {flag && (
        <div className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm', flag.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
          {flag.tone === 'ok' ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> : <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />}
          <p>{flag.text}</p>
        </div>
      )}

      <ConnectionCard status={p.status} isAdmin={p.isAdmin} pending={pending} onSync={() => run(syncXeroNow, 'Sync complete')} onDisconnect={() => { if (confirm('Disconnect ECR from Xero? Existing links are kept; nothing syncs until you reconnect.')) run(disconnectXero, 'Disconnected from Xero') }} onConfirmSwitch={(name) => run(() => confirmXeroOrgSwitch(name), 'Switched organisation — all old Xero links cleared')} />

      {p.status.connected && (
        <>
          <MappingForm mapping={p.mapping} accounts={p.accounts} taxRates={p.taxRates} categories={p.trackingCategories} disabled={!p.isAdmin || pending} onSave={(data) => run(() => saveXeroMapping(data), 'Xero mapping saved')} />
          <UnlinkedClients clients={p.unlinkedClients} contacts={p.contacts} pending={pending} onLink={(c, x) => run(() => linkClientToXeroContact(c, x), 'Client linked')} />
          {p.pendingClaims.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Certified claims not yet in Xero</h2>
              <div className="rounded-xl border">
                <Table>
                  <TableHeader><TableRow><TableHead>Claim</TableHead><TableHead className="text-right">Certified</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
                  <TableBody>
                    {p.pendingClaims.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{`${c.project_number} · PC-${c.number}`}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.certified_amount != null ? c.certified_amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }) : '—'}</TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryClaimPush(c.id), 'Claim pushed to Xero')}>Retry</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </>
      )}

      <Register runs={p.runs} events={p.events} />
    </div>
  )
}

function ConnectionCard({ status, isAdmin, pending, onSync, onDisconnect, onConfirmSwitch }: {
  status: XeroStatus; isAdmin: boolean; pending: boolean
  onSync: () => void; onDisconnect: () => void; onConfirmSwitch: (name: string) => void
}) {
  const [typed, setTyped] = useState('')
  const tone = status.connected ? 'ok' : status.status === 'needs_reconnect' ? 'bad' : 'muted'
  return (
    <section className={cn('flex flex-col gap-3 rounded-xl border p-4', tone === 'bad' && 'border-red-300 bg-red-50/50')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Xero connection</h2>
          {!status.available ? (
            <p className="text-sm text-amber-700">{status.reason}</p>
          ) : status.connected ? (
            <p className="text-sm text-muted-foreground">{`Connected to ${status.tenantName ?? 'Xero'} since ${fmtWhen(status.connectedAt)} · last sync ${fmtWhen(status.lastSyncAt)}${status.lastSyncStatus ? ` (${status.lastSyncStatus})` : ''}`}</p>
          ) : status.pendingOrgSwitch ? (
            <p className="text-sm text-red-700">{`Tokens received for "${status.pendingOrgSwitch.tenantName}", which is a different organisation than before.`}</p>
          ) : status.status === 'needs_reconnect' ? (
            <p className="text-sm text-red-700">Xero access expired or was revoked. Reconnect to resume sending and syncing.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Not connected. Connecting opens Xero&apos;s own login — no Xero password is stored in ECR.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status.available && status.connected && (
            <Button variant="outline" disabled={pending} onClick={onSync}><RefreshCwIcon className={cn(pending && 'animate-spin')} />Sync now</Button>
          )}
          {status.available && isAdmin && !status.pendingOrgSwitch && (
            status.connected ? (
              <Button variant="outline" className="text-destructive border-destructive/50" disabled={pending} onClick={onDisconnect}><UnplugIcon />Disconnect</Button>
            ) : (
              <a href="/api/xero/connect" className={cn(buttonVariants())}><Link2Icon />{status.status === 'needs_reconnect' ? 'Reconnect to Xero' : 'Connect to Xero'}</a>
            )
          )}
        </div>
      </div>
      {status.pendingOrgSwitch && isAdmin && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-white p-3 text-sm">
          <p>Confirming will <strong>clear every Xero link</strong> on invoices, claims, payments, clients, jobs and projects (they belonged to the previous organisation) and empty the cached accounts and contacts. The sync register is kept. Type the organisation name to confirm.</p>
          <div className="flex flex-wrap gap-2">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={status.pendingOrgSwitch.tenantName} className="max-w-xs" />
            <Button variant="destructive" disabled={pending || typed.trim().length === 0} onClick={() => onConfirmSwitch(typed)}>Switch organisation</Button>
          </div>
        </div>
      )}
    </section>
  )
}

function AccountSelect({ id, active, value, onChange, allowNone }: {
  id: string; active: XeroAccountRow[]; value: string | null; onChange: (v: string | null) => void; allowNone: boolean
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE || v == null ? null : String(v))}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>Use default</SelectItem>}
        {!allowNone && <SelectItem value={NONE}>— choose —</SelectItem>}
        {active.map((a) => <SelectItem key={a.code} value={a.code}>{`${a.code} · ${a.name}`}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function MappingForm({ mapping, accounts, taxRates, categories, disabled, onSave }: {
  mapping: XeroMappingRow; accounts: XeroAccountRow[]; taxRates: XeroTaxRateRow[]; categories: XeroTrackingCategoryRow[]
  disabled: boolean; onSave: (data: XeroMappingRow) => void
}) {
  const [m, setM] = useState<XeroMappingRow>(mapping)
  const active = accounts.filter((a) => a.status !== 'ARCHIVED')
  const cats = categories.filter((c) => c.status !== 'ARCHIVED')
  const set = <K extends keyof XeroMappingRow>(k: K, v: XeroMappingRow[K]) => setM((prev) => ({ ...prev, [k]: v }))

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-base font-semibold">Account &amp; tax mapping</h2>
      {active.length === 0 && <p className="text-sm text-amber-700">No accounts cached yet — run a sync first.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5"><Label htmlFor="x-default">Default income account</Label><AccountSelect id="x-default" active={active} value={m.xero_default_account} onChange={(v) => set('xero_default_account', v)} allowNone={false} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="x-claims">Progress claims account</Label><AccountSelect id="x-claims" active={active} value={m.xero_claims_account} onChange={(v) => set('xero_claims_account', v)} allowNone={false} /></div>
        {RATE_KINDS.map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <Label htmlFor={`x-kind-${k}`}>{`${KIND_LABELS[k]} lines`}</Label>
            <AccountSelect id={`x-kind-${k}`} active={active} value={m.xero_account_by_kind[k] ?? null} allowNone onChange={(v) => { const next = { ...m.xero_account_by_kind }; if (v) next[k] = v; else delete next[k]; set('xero_account_by_kind', next) }} />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-gst">GST tax rate</Label>
          <Select value={m.xero_gst_tax_type} onValueChange={(v) => set('xero_gst_tax_type', String(v ?? 'OUTPUT'))}>
            <SelectTrigger id="x-gst" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{taxRates.map((t) => <SelectItem key={t.tax_type} value={t.tax_type}>{`${t.name}${t.effective_rate != null ? ` (${t.effective_rate}%)` : ''}`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-nogst">No-GST tax rate (0% invoices)</Label>
          <Select value={m.xero_no_gst_tax_type} onValueChange={(v) => set('xero_no_gst_tax_type', String(v ?? 'EXEMPTOUTPUT'))}>
            <SelectTrigger id="x-nogst" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{taxRates.map((t) => <SelectItem key={t.tax_type} value={t.tax_type}>{`${t.name}${t.effective_rate != null ? ` (${t.effective_rate}%)` : ''}`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-tracking">Tracking category used for the job number</Label>
          <Select value={m.xero_tracking_category_id ?? NONE} onValueChange={(v) => set('xero_tracking_category_id', v === NONE || v == null ? null : String(v))}>
            <SelectTrigger id="x-tracking" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No tracking</SelectItem>
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Xero allows two active categories with 100 options each. ECR archives options for jobs paid more than 90 days ago.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-email">Who emails the client</Label>
          <Select value={m.xero_email_mode} onValueChange={(v) => set('xero_email_mode', (v as 'xero' | 'ecr') ?? 'xero')}>
            <SelectTrigger id="x-email" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="xero">Xero emails the invoice (Xero template, pay-now link)</SelectItem>
              <SelectItem value="ecr">I send ECR&apos;s PDF myself (Xero still records the invoice)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Button disabled={disabled} onClick={() => onSave(m)}>Save mapping</Button></div>
    </section>
  )
}

function UnlinkedClients({ clients, contacts, pending, onLink }: {
  clients: UnlinkedClientRow[]; contacts: XeroContactRow[]; pending: boolean
  onLink: (clientId: string, contactId: string | null) => void
}) {
  const [choice, setChoice] = useState<Record<string, string>>({})
  if (clients.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Clients without a Xero contact</h2>
      <p className="text-sm text-muted-foreground">Matched automatically by ABN, then exact name. Pick the contact for the rest, or leave them — a contact is created on their first invoice.</p>
      <div className="rounded-xl border">
        <Table>
          <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>ABN</TableHead><TableHead>Xero contact</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{c.abn ?? '—'}</TableCell>
                <TableCell>
                  <select aria-label={`Xero contact for ${c.name}`} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm" value={choice[c.id] ?? ''} onChange={(e) => setChoice((prev) => ({ ...prev, [c.id]: e.target.value }))}>
                    <option value="">— choose —</option>
                    {contacts.map((x) => <option key={x.contact_id} value={x.contact_id}>{`${x.name}${x.abn ? ` · ${x.abn}` : ''}`}</option>)}
                  </select>
                </TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" disabled={pending || !choice[c.id]} onClick={() => onLink(c.id, choice[c.id])}>Link</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

const RUN_BADGE: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
}

function Register({ runs, events }: { runs: XeroRunRow[]; events: XeroEventRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Sync register</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No syncs or pushes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Checked</TableHead><TableHead className="text-right">New</TableHead><TableHead className="text-right">Payments</TableHead><TableHead className="text-right">Pushed</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fmtWhen(r.started_at)}</TableCell>
                  <TableCell>{r.trigger}</TableCell>
                  <TableCell><Badge variant="outline" className={RUN_BADGE[r.status] ?? ''}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoices_pulled}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoices_created}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.payments_upserted}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pushed}</TableCell>
                  <TableCell className="max-w-80 truncate text-xs text-muted-foreground">{r.error ?? (r.warnings ? `${r.warnings} warning(s)` : '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {events.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Dir</TableHead><TableHead>Entity</TableHead><TableHead>Action</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fmtWhen(e.created_at)}</TableCell>
                  <TableCell>{e.direction}</TableCell>
                  <TableCell>{e.entity}</TableCell>
                  <TableCell><Badge variant="outline" className={e.action === 'failed' ? RUN_BADGE.failed : e.action === 'warning' || e.action === 'unmatched' ? RUN_BADGE.partial : ''}>{e.action}</Badge></TableCell>
                  <TableCell className="max-w-96 truncate text-xs text-muted-foreground">{e.detail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
