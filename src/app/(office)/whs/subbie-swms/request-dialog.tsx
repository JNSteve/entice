'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CopyIcon, FileTextIcon, MailIcon, QrCodeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createShareLink } from '@/lib/share-links'

export interface RequestProjectOption {
  id: string
  number: string
  name: string
}

function copyUrl(url: string) {
  navigator.clipboard
    .writeText(url)
    .then(() => toast.success('Link copied'))
    .catch(() => toast.error('Could not copy — copy it manually'))
}

function mailtoHref(projectLabel: string, url: string): string {
  const subject = `SWMS request — ${projectLabel}`
  const body = [
    `Please submit your SWMS for ${projectLabel}: ${url}`,
    '',
    'Open the link, fill in your details and attach your SWMS as a PDF.',
    'No login or app needed.',
  ].join('\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/**
 * "Request subbie SWMS" button + dialog for the WHS hub: picks an active
 * project, labels the link (e.g. "AquaSeal — membrane works SWMS") and
 * creates a kind 'subbie_swms' share link, then offers copy / email / QR
 * poster for sending to the subcontractor.
 */
export function RequestSubbieSwmsDialog({
  projects,
}: {
  projects: RequestProjectOption[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [projectId, setProjectId] = useState('')
  const [label, setLabel] = useState('')
  const [expiresDays, setExpiresDays] = useState('30')
  const [created, setCreated] = useState<{
    id: string
    url: string
    projectLabel: string
  } | null>(null)

  function handleOpen() {
    setOpen(true)
    setCreated(null)
    setProjectId('')
    setLabel('')
    setExpiresDays('30')
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) {
      toast.error('Pick a project')
      return
    }
    const days = expiresDays.trim() === '' ? null : Number(expiresDays)
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      toast.error('Expiry must be a whole number of days (1–365)')
      return
    }
    startTransition(async () => {
      const result = await createShareLink({
        kind: 'subbie_swms',
        projectId,
        label: label.trim(),
        expiresDays: days,
        origin: window.location.origin,
      })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('url' in result) {
        const project = projects.find((p) => p.id === projectId)
        setCreated({
          id: result.id,
          url: result.url,
          projectLabel: project ? `${project.number} — ${project.name}` : 'the project',
        })
        toast.success('Submission link created')
      }
    })
  }

  return (
    <>
      <Button size="sm" onClick={handleOpen}>
        <QrCodeIcon className="size-4" />
        Request subbie SWMS
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request subbie SWMS</DialogTitle>
          </DialogHeader>

          {created ? (
            <div className="flex flex-col gap-3 rounded-xl border border-green-500/40 bg-green-500/10 p-4">
              <p className="text-sm font-semibold">Link ready to send</p>
              <p className="text-xs text-muted-foreground">
                The subcontractor opens it on any device — no login — and
                uploads their SWMS PDF for review.
              </p>
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
                  render={<a href={mailtoHref(created.projectLabel, created.url)} />}
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
          ) : (
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Project</Label>
                <Select value={projectId} onValueChange={(v) => setProjectId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.number} — {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subbie-link-label">Label</Label>
                <Input
                  id="subbie-link-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. AquaSeal — membrane works SWMS"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subbie-link-expiry">Expires in (days)</Label>
                <Input
                  id="subbie-link-expiry"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="No expiry"
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !label.trim() || !projectId}>
                  {pending ? 'Creating…' : 'Create link'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
