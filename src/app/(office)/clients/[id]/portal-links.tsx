'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CopyIcon, LinkIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { fmtDate } from '@/lib/format'
import { clientLinkState, type ClientLinkState } from '@/lib/portal'
import {
  createClientLink,
  revokeClientLink,
  setClientLinkFinancials,
  setClientLinkNotifications,
} from '@/lib/client-links'

export interface ClientLinkRow {
  id: string
  token: string
  label: string | null
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  show_financials: boolean
  notifications_enabled: boolean
}

function portalUrl(token: string): string {
  return `${window.location.origin}/portal/${token}`
}

function copyUrl(url: string) {
  navigator.clipboard
    .writeText(url)
    .then(() => toast.success('Portal link copied'))
    .catch(() => toast.error('Could not copy — copy it manually'))
}

const STATE_BADGE: Record<ClientLinkState, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className:
      'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  },
  revoked: {
    label: 'Revoked',
    className:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  },
  expired: {
    label: 'Expired',
    className:
      'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400',
  },
}

function IssueLinkDialog({
  clientId,
  defaultLabel,
}: {
  clientId: string
  defaultLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [label, setLabel] = useState(defaultLabel)
  const [expiresDays, setExpiresDays] = useState('')
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createClientLink({
        client_id: clientId,
        label,
        expiresDays: expiresDays === '' ? null : Number(expiresDays),
        origin: window.location.origin,
      })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('url' in result) {
        setIssuedUrl(result.url)
        copyUrl(result.url)
      }
    })
  }

  function close() {
    setOpen(false)
    setIssuedUrl(null)
    setLabel(defaultLabel)
    setExpiresDays('')
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        Issue portal link
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Issue portal link</DialogTitle>
          </DialogHeader>
          {issuedUrl ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Link issued and copied. Anyone with this URL can view the
                client&apos;s properties, compliance register and shared works
                evidence — treat it like a password.
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={issuedUrl} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => copyUrl(issuedUrl)}
                  aria-label="Copy portal link"
                >
                  <CopyIcon />
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" onClick={close}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-label">Label</Label>
                <Input
                  id="cl-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Facilities team"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-expiry">Expires after (days, optional)</Label>
                <Input
                  id="cl-expiry"
                  type="number"
                  min={1}
                  max={3650}
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  placeholder="Never"
                  className="max-w-32"
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Issuing…' : 'Issue link'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PortalLinks({
  clientId,
  clientName,
  links,
  canManage,
  unreadMessages = 0,
}: {
  clientId: string
  clientName: string
  links: ClientLinkRow[]
  canManage: boolean
  /** Unread client portal messages across this client's properties. */
  unreadMessages?: number
}) {
  const [pending, startTransition] = useTransition()
  const [revokingId, setRevokingId] = useState<string | null>(null)

  function handleRevoke(link: ClientLinkRow) {
    if (
      !confirm(
        `Revoke "${link.label ?? 'this link'}"? The client will lose portal access on this URL immediately.`
      )
    )
      return
    setRevokingId(link.id)
    startTransition(async () => {
      const result = await revokeClientLink(link.id, clientId)
      setRevokingId(null)
      if (result.error) toast.error(result.error)
      else toast.success('Link revoked')
    })
  }

  function handleFinancialsToggle(link: ClientLinkRow, show: boolean) {
    startTransition(async () => {
      const result = await setClientLinkFinancials(link.id, clientId, show)
      if (result.error) toast.error(result.error)
      else {
        toast.success(
          show
            ? 'Billing history is now visible on this link'
            : 'Billing history hidden on this link'
        )
      }
    })
  }

  function handleNotificationsToggle(link: ClientLinkRow, enabled: boolean) {
    startTransition(async () => {
      const result = await setClientLinkNotifications(link.id, clientId, enabled)
      if (result.error) toast.error(result.error)
      else {
        toast.success(
          enabled
            ? 'Daily compliance digest enabled on this link'
            : 'Daily compliance digest turned off on this link'
        )
      }
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <LinkIcon className="size-4 text-muted-foreground" />
          Client portal
          {unreadMessages > 0 && (
            <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
              {unreadMessages} unread message{unreadMessages === 1 ? '' : 's'}
            </Badge>
          )}
        </h2>
        {canManage && <IssueLinkDialog clientId={clientId} defaultLabel={clientName} />}
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No portal links issued. A portal link gives this client a read-only,
          no-login window onto their properties, compliance register and the
          works evidence you explicitly share.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Digest</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => {
                const state = clientLinkState(link)
                const badge = STATE_BADGE[state]
                return (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">{link.label ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={badge.className}>
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmtDate(link.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {link.expires_at ? fmtDate(link.expires_at) : 'Never'}
                    </TableCell>
                    <TableCell>
                      {/* Billing tab gate — issued invoices/claims per property */}
                      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={link.show_financials}
                          disabled={!canManage || pending || state !== 'active'}
                          onCheckedChange={(checked) =>
                            handleFinancialsToggle(link, checked === true)
                          }
                          aria-label={`Show billing history on ${link.label ?? 'this link'}`}
                        />
                        {link.show_financials ? 'Visible' : 'Hidden'}
                      </label>
                    </TableCell>
                    <TableCell>
                      {/* Daily compliance digest gate (CP3 notifications) */}
                      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={link.notifications_enabled}
                          disabled={!canManage || pending || state !== 'active'}
                          onCheckedChange={(checked) =>
                            handleNotificationsToggle(link, checked === true)
                          }
                          aria-label={`Send the daily compliance digest on ${link.label ?? 'this link'}`}
                        />
                        {link.notifications_enabled ? 'On' : 'Off'}
                      </label>
                    </TableCell>
                    <TableCell>
                      {state === 'active' && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => copyUrl(portalUrl(link.token))}
                            aria-label={`Copy portal link ${link.label ?? ''}`}
                          >
                            <CopyIcon />
                          </Button>
                          {canManage && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={pending && revokingId === link.id}
                              onClick={() => handleRevoke(link)}
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
