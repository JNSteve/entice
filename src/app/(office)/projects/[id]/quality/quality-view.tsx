'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { FileTextIcon, PlusIcon } from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtDate } from '@/lib/format'
import type { LotStatus } from '@/lib/zod'
import {
  adoptItp,
  createLot,
  closeItpInstance,
  reopenItpInstance,
} from './actions'

export type ItpTemplateOption = {
  id: string
  name: string
  activity: string
  discipline: string | null
}

export type ItpInstanceRow = {
  id: string
  number: string
  title: string
  activity: string
  status: string
  adopted_at: string
  itemsTotal: number
  itemsPassed: number
  itemsNa: number
  holdItems: number
}

export type LotRow = {
  id: string
  number: string
  description: string
  location: string | null
  status: LotStatus
  opened_on: string
  itpNumber: string
  openHoldPoints: number
}

export function QualityView({
  projectId,
  templates,
  instances,
  lots,
  isAdmin,
}: {
  projectId: string
  templates: ItpTemplateOption[]
  instances: ItpInstanceRow[]
  lots: LotRow[]
  isAdmin: boolean
}) {
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [lotOpen, setLotOpen] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      {/* ITP instances */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Inspection &amp; Test Plans</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdoptOpen(true)}
            disabled={templates.length === 0}
          >
            <PlusIcon className="size-4" />
            Adopt ITP
          </Button>
        </div>
        {instances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ITP adopted on this project yet — adopt a template to start
            recording inspection and test conformance (ISO 9001 8.5/8.6).
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>ITP</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Hold points</TableHead>
                  <TableHead>Adopted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono">{i.number}</TableCell>
                    <TableCell className="font-medium">{i.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {i.activity}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {i.itemsPassed}/{i.itemsTotal - i.itemsNa} passed
                      {i.itemsNa > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({i.itemsNa} N/A)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{i.holdItems}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(i.adopted_at)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={i.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ItpCloseButton
                          projectId={projectId}
                          instanceId={i.id}
                          number={i.number}
                          status={i.status}
                          isAdmin={isAdmin}
                        />
                        <a
                          href={`/api/pdf/itp/${i.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="ITP PDF"
                        >
                          <Button type="button" variant="ghost" size="icon-sm">
                            <FileTextIcon className="size-3.5" />
                          </Button>
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Lots register */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Lots</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLotOpen(true)}
            disabled={instances.filter((i) => i.status === 'active').length === 0}
          >
            <PlusIcon className="size-4" />
            New lot
          </Button>
        </div>
        {lots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lots yet — break the work into conformance lots against an
            adopted ITP. Each lot carries its own inspection and test records.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>ITP</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Hold points</TableHead>
                  <TableHead>Conformance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lots.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${projectId}/quality/lots/${l.id}`}
                        className="font-mono hover:underline"
                      >
                        {l.number}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{l.description}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.location ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {l.itpNumber}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(l.opened_on)}
                    </TableCell>
                    <TableCell>
                      {l.openHoldPoints > 0 ? (
                        <span className="font-medium text-red-600 tabular-nums dark:text-red-400">
                          {l.openHoldPoints} open
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {adoptOpen && (
        <AdoptItpDialog
          projectId={projectId}
          templates={templates}
          onClose={() => setAdoptOpen(false)}
        />
      )}
      {lotOpen && (
        <NewLotDialog
          projectId={projectId}
          instances={instances.filter((i) => i.status === 'active')}
          onClose={() => setLotOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Close / reopen an ITP ────────────────────────────────────────────────────

function ItpCloseButton({
  projectId,
  instanceId,
  number,
  status,
  isAdmin,
}: {
  projectId: string
  instanceId: string
  number: string
  status: string
  isAdmin: boolean
}) {
  const [pending, startTransition] = useTransition()

  if (status === 'closed') {
    if (!isAdmin) return null
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await reopenItpInstance(projectId, instanceId)
            if (res.error) toast.error(res.error)
            else toast.success(`${number} reopened`)
          })
        }
      >
        Reopen
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await closeItpInstance(projectId, instanceId)
          if (res.error) toast.error(res.error)
          else toast.success(`${number} closed`)
        })
      }
    >
      Close
    </Button>
  )
}

// ─── Adopt ITP dialog ─────────────────────────────────────────────────────────

function AdoptItpDialog({
  projectId,
  templates,
  onClose,
}: {
  projectId: string
  templates: ItpTemplateOption[]
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')

  const selected = templates.find((t) => t.id === templateId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await adoptItp({ project_id: projectId, template_id: templateId })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('ITP adopted — template items copied to this project')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adopt an ITP template</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="itp-template">
              Template <span className="text-destructive">*</span>
            </Label>
            <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
              <SelectTrigger id="itp-template" className="w-full">
                <SelectValue placeholder="Pick a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <p className="text-sm text-muted-foreground">
              {selected.activity}
              {selected.discipline ? ` · ${selected.discipline}` : ''}. Items are
              copied at adoption — later template edits never change this ITP.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !templateId}>
              {pending ? 'Adopting…' : 'Adopt ITP'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── New lot dialog ───────────────────────────────────────────────────────────

function NewLotDialog({
  projectId,
  instances,
  onClose,
}: {
  projectId: string
  instances: ItpInstanceRow[]
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? '')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')

  const selected = instances.find((i) => i.id === instanceId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await createLot({
        project_id: projectId,
        itp_instance_id: instanceId,
        description,
        location: location || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        selected && selected.holdItems > 0
          ? `Lot created — ${selected.holdItems} hold point${selected.holdItems === 1 ? '' : 's'} raised`
          : 'Lot created'
      )
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New lot</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lot-itp">
              ITP <span className="text-destructive">*</span>
            </Label>
            <Select value={instanceId} onValueChange={(v) => v && setInstanceId(v)}>
              <SelectTrigger id="lot-itp" className="w-full">
                <SelectValue placeholder="Pick an adopted ITP…" />
              </SelectTrigger>
              <SelectContent>
                {instances.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number} — {i.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lot-description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="lot-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Subgrade — northern car park, layer 2"
              rows={2}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lot-location">Location / chainage</Label>
            <Input
              id="lot-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Ch 0–120, Lot 3 area"
            />
          </div>
          {selected && selected.holdItems > 0 && (
            <p className="text-sm text-muted-foreground">
              This ITP carries {selected.holdItems} hold-point item
              {selected.holdItems === 1 ? '' : 's'} — hold points are raised on
              the lot and must be released before it can close.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !instanceId || !description.trim()}
            >
              {pending ? 'Creating…' : 'Create lot'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
