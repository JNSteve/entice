'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PencilIcon } from 'lucide-react'
import { updateJob } from '../actions'

const NONE = 'none'

interface SiteOption {
  id: string
  name: string
  client_id: string
}

interface SupervisorOption {
  id: string
  full_name: string
}

interface EditJobDialogProps {
  jobId: string
  clientId: string
  title: string
  description: string | null
  siteId: string | null
  supervisorId: string | null
  scheduledStart: string | null
  scheduledEnd: string | null
  sites: SiteOption[]
  supervisors: SupervisorOption[]
}

export function EditJobDialog({
  jobId,
  clientId,
  title: initialTitle,
  description: initialDescription,
  siteId: initialSiteId,
  supervisorId: initialSupervisorId,
  scheduledStart: initialStart,
  scheduledEnd: initialEnd,
  sites,
  supervisors,
}: EditJobDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [siteId, setSiteId] = useState(initialSiteId ?? NONE)
  const [supervisorId, setSupervisorId] = useState(initialSupervisorId ?? NONE)
  const [scheduledStart, setScheduledStart] = useState(initialStart ?? '')
  const [scheduledEnd, setScheduledEnd] = useState(initialEnd ?? '')

  const clientSites = sites.filter((s) => s.client_id === clientId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateJob(jobId, {
        title,
        description: description || null,
        site_id: siteId === NONE ? null : siteId,
        supervisor_id: supervisorId === NONE ? null : supervisorId,
        scheduled_start: scheduledStart || null,
        scheduled_end: scheduledEnd || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Job updated')
      setOpen(false)
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ej-title">Title</Label>
              <Input
                id="ej-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ej-description">Description</Label>
              <Textarea
                id="ej-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ej-site">Site</Label>
              <Select value={siteId} onValueChange={(v) => setSiteId(v ?? NONE)}>
                <SelectTrigger id="ej-site" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No site</SelectItem>
                  {clientSites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ej-supervisor">Supervisor</Label>
              <Select value={supervisorId} onValueChange={(v) => setSupervisorId(v ?? NONE)}>
                <SelectTrigger id="ej-supervisor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No supervisor</SelectItem>
                  {supervisors.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ej-start">Start date</Label>
                <Input
                  id="ej-start"
                  type="date"
                  value={scheduledStart}
                  onChange={(e) => setScheduledStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ej-end">End date</Label>
                <Input
                  id="ej-end"
                  type="date"
                  value={scheduledEnd}
                  onChange={(e) => setScheduledEnd(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
