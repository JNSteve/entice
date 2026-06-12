'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import {
  CopyIcon,
  FileTextIcon,
  MailIcon,
  PlusIcon,
  QrCodeIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { createShareLink, deactivateShareLink } from '@/lib/share-links'

/** Exactly one of the two sign-on targets. */
export type ShareLinkTarget =
  | { swmsInstanceId: string }
  | { formSubmissionId: string }

interface ShareLinkRow {
  id: string
  token: string
  label: string | null
  created_at: string
  expires_at: string | null
}

interface ShareLinkDialogProps {
  target: ShareLinkTarget
  /** Default label for new links, e.g. the SWMS/template title. */
  defaultLabel: string
  buttonVariant?: 'outline' | 'ghost'
  buttonSize?: 'sm' | 'lg'
}

function signUrl(token: string): string {
  return `${window.location.origin}/sign/${token}`
}

function copyUrl(url: string) {
  navigator.clipboard
    .writeText(url)
    .then(() => toast.success('Link copied'))
    .catch(() => toast.error('Could not copy — copy it manually'))
}

function mailtoHref(label: string, url: string): string {
  const subject = `Sign on: ${label}`
  const body = [
    `Please sign on to "${label}" before starting work.`,
    '',
    'Open this link on your phone, read the document and sign:',
    url,
    '',
    'No login or app needed.',
  ].join('\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/**
 * "Sign-on link" dialog: lists the active external sign-on links for a SWMS
 * instance or a form submission (copy URL / email / QR poster / deactivate)
 * and creates new ones. Used from the office SWMS section, the WHS forms
 * register drawer and the field submission screen (staff roles only — RLS
 * limits share_links reads/writes to admin/office/supervisor).
 */
export function ShareLinkDialog({
  target,
  defaultLabel,
  buttonVariant = 'outline',
  buttonSize = 'sm',
}: ShareLinkDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [links, setLinks] = useState<ShareLinkRow[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [label, setLabel] = useState(defaultLabel)
  const [expiresDays, setExpiresDays] = useState('')
  const [created, setCreated] = useState<{ id: string; url: string; label: string } | null>(null)

  async function loadLinks() {
    const supabase = createClient()
    let query = supabase
      .from('share_links')
      .select('id, token, label, created_at, expires_at')
      .eq('kind', 'signon')
      .eq('active', true)
      .order('created_at', { ascending: false })
    query =
      'swmsInstanceId' in target
        ? query.eq('swms_instance_id', target.swmsInstanceId)
        : query.eq('form_submission_id', target.formSubmissionId)
    const { data, error } = await query
    if (error) {
      toast.error(error.message)
      setLinks([])
      return
    }
    setLinks((data ?? []) as ShareLinkRow[])
  }

  function handleOpen() {
    setOpen(true)
    setLinks(null)
    setCreated(null)
    setShowNew(false)
    setLabel(defaultLabel)
    setExpiresDays('')
    void loadLinks()
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const days = expiresDays.trim() === '' ? null : Number(expiresDays)
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      toast.error('Expiry must be a whole number of days (1–365)')
      return
    }
    startTransition(async () => {
      const result = await createShareLink({
        kind: 'signon',
        ...target,
        label: label.trim(),
        expiresDays: days,
        origin: window.location.origin,
      })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('url' in result) {
        setCreated({ id: result.id, url: result.url, label: label.trim() })
        setShowNew(false)
        toast.success('Sign-on link created')
        void loadLinks()
      }
    })
  }

  function handleDeactivate(id: string) {
    if (!confirm('Deactivate this link? Anyone holding it will see "link expired".')) return
    startTransition(async () => {
      const result = await deactivateShareLink(id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Link deactivated')
      if (created?.id === id) setCreated(null)
      void loadLinks()
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize}
        onClick={handleOpen}
      >
        <QrCodeIcon className="size-4" />
        Sign-on link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>External sign-on links</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Freshly created link — front and centre */}
            {created && (
              <div className="flex flex-col gap-3 rounded-xl border border-green-500/40 bg-green-500/10 p-4">
                <p className="text-sm font-semibold">Link ready to share</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={created.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="Copy link"
                    onClick={() => copyUrl(created.url)}
                  >
                    <CopyIcon className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    render={<a href={mailtoHref(created.label, created.url)} />}
                  >
                    <MailIcon className="size-4" />
                    Email link
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    render={
                      <a
                        href={`/api/pdf/qr-poster/${created.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <FileTextIcon className="size-4" />
                    Download QR poster (PDF)
                  </Button>
                </div>
              </div>
            )}

            {/* Existing active links */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Active links
              </p>
              {links === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : links.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active links yet — create one below.
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {links.map((link) => (
                    <div key={link.id} className="flex flex-col gap-2 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">
                          {link.label ?? 'Sign-on link'}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => handleDeactivate(link.id)}
                          className="shrink-0 text-destructive hover:text-destructive"
                        >
                          Deactivate
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {format(parseISO(link.created_at), 'dd/MM/yyyy')}
                        {' · '}
                        {link.expires_at
                          ? `Expires ${format(parseISO(link.expires_at), 'dd/MM/yyyy')}`
                          : 'No expiry'}
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyUrl(signUrl(link.token))}
                        >
                          <CopyIcon className="size-3.5" />
                          Copy URL
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          render={
                            <a
                              href={mailtoHref(link.label ?? 'Sign on', signUrl(link.token))}
                            />
                          }
                        >
                          <MailIcon className="size-3.5" />
                          Email
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          render={
                            <a
                              href={`/api/pdf/qr-poster/${link.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                        >
                          <QrCodeIcon className="size-3.5" />
                          QR poster
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* New link */}
            {showNew ? (
              <form
                onSubmit={handleCreate}
                className="flex flex-col gap-3 rounded-xl border p-4"
              >
                <p className="text-sm font-semibold">New link</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-link-label">Label</Label>
                  <Input
                    id="share-link-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-link-expiry">Expires in (days, optional)</Label>
                  <Input
                    id="share-link-expiry"
                    type="number"
                    min={1}
                    max={365}
                    placeholder="No expiry"
                    value={expiresDays}
                    onChange={(e) => setExpiresDays(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={pending || !label.trim()}>
                    {pending ? 'Creating…' : 'Create link'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowNew(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowNew(true)
                  setLabel((v) => v || defaultLabel)
                }}
              >
                <PlusIcon className="size-4" />
                New link
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
