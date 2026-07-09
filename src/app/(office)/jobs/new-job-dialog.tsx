'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { createJob } from './actions'
import { PlusIcon } from 'lucide-react'

const NONE = 'none'

interface Option {
  id: string
  name: string
}

interface ClientScopedOption extends Option {
  client_id: string
}

interface ProfileOption {
  id: string
  full_name: string
}

export function NewJobDialog({
  clients,
  sites,
  supervisors,
  pms,
}: {
  clients: Option[]
  sites: ClientScopedOption[]
  supervisors: ProfileOption[]
  pms: ProfileOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState(NONE)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [supervisorId, setSupervisorId] = useState(NONE)
  const [pmId, setPmId] = useState(NONE)

  const clientSites = sites.filter((s) => s.client_id === clientId)

  function handleClientChange(id: string) {
    setClientId(id)
    setSiteId(NONE)
  }

  function reset() {
    setClientId('')
    setSiteId(NONE)
    setTitle('')
    setDescription('')
    setSupervisorId(NONE)
    setPmId(NONE)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) {
      toast.error('Pick a client')
      return
    }
    startTransition(async () => {
      const result = await createJob({
        client_id: clientId,
        site_id: siteId === NONE ? null : siteId,
        title,
        description: description || null,
        supervisor_id: supervisorId === NONE ? null : supervisorId,
        pm_id: pmId === NONE ? null : pmId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Job created')
      setOpen(false)
      reset()
      if (result.id) router.push(`/jobs/${result.id}`)
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New job
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nj-client">Client</Label>
              <Select
                value={clientId || null}
                onValueChange={(v) => v && handleClientChange(v)}
              >
                <SelectTrigger id="nj-client" className="w-full">
                  <SelectValue placeholder="Pick a client…" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nj-site">Site (optional)</Label>
              <Select
                value={siteId}
                onValueChange={(v) => setSiteId(v ?? NONE)}
                disabled={!clientId}
              >
                <SelectTrigger id="nj-site" className="w-full">
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
              <Label htmlFor="nj-title">Title</Label>
              <Input
                id="nj-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Roof restoration — 12 Smith St"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nj-description">Description (optional)</Label>
              <Textarea
                id="nj-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Scope of work…"
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nj-supervisor">Supervisor (optional)</Label>
              <Select
                value={supervisorId}
                onValueChange={(v) => setSupervisorId(v ?? NONE)}
              >
                <SelectTrigger id="nj-supervisor" className="w-full">
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nj-pm">PM (optional)</Label>
              <Select
                value={pmId}
                onValueChange={(v) => setPmId(v ?? NONE)}
              >
                <SelectTrigger id="nj-pm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No PM</SelectItem>
                  {pms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !clientId}>
                {pending ? 'Creating…' : 'Create job'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
