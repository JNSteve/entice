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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MoneyInput } from '@/components/MoneyInput'
import { createProject } from './actions'
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

export function NewProjectDialog({
  clients,
  sites,
  supervisors,
}: {
  clients: Option[]
  sites: ClientScopedOption[]
  supervisors: ProfileOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState(NONE)
  const [name, setName] = useState('')
  const [contractSum, setContractSum] = useState<number | null>(null)
  const [retentionPct, setRetentionPct] = useState('10')
  const [retentionCapPct, setRetentionCapPct] = useState('5')
  const [dlpMonths, setDlpMonths] = useState('12')
  const [claimDay, setClaimDay] = useState('25')
  const [startDate, setStartDate] = useState('')
  const [supervisorId, setSupervisorId] = useState(NONE)

  const clientSites = sites.filter((s) => s.client_id === clientId)

  function handleClientChange(id: string) {
    setClientId(id)
    setSiteId(NONE)
  }

  function reset() {
    setClientId('')
    setSiteId(NONE)
    setName('')
    setContractSum(null)
    setRetentionPct('10')
    setRetentionCapPct('5')
    setDlpMonths('12')
    setClaimDay('25')
    setStartDate('')
    setSupervisorId(NONE)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) {
      toast.error('Pick a client')
      return
    }
    startTransition(async () => {
      const result = await createProject({
        client_id: clientId,
        site_id: siteId === NONE ? null : siteId,
        name,
        contract_sum: contractSum ?? 0,
        retention_pct: retentionPct,
        retention_cap_pct: retentionCapPct,
        dlp_months: dlpMonths,
        claim_day: claimDay,
        start_date: startDate || null,
        supervisor_id: supervisorId === NONE ? null : supervisorId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Project created')
      setOpen(false)
      reset()
      if (result.id) router.push(`/projects/${result.id}`)
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New project
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-client">Client</Label>
                <Select
                  value={clientId || undefined}
                  onValueChange={(v) => v && handleClientChange(v)}
                >
                  <SelectTrigger id="np-client" className="w-full">
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
                <Label htmlFor="np-site">Site (optional)</Label>
                <Select
                  value={siteId}
                  onValueChange={(v) => setSiteId(v ?? NONE)}
                  disabled={!clientId}
                >
                  <SelectTrigger id="np-site" className="w-full">
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-name">Project name</Label>
              <Input
                id="np-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Civic Centre upgrade — Stage 2"
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-sum">Contract sum (ex GST)</Label>
                <MoneyInput value={contractSum} onChange={setContractSum} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-start">Start date (optional)</Label>
                <Input
                  id="np-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-retention">Retention %</Label>
                <Input
                  id="np-retention"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={retentionPct}
                  onChange={(e) => setRetentionPct(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-cap">Cap %</Label>
                <Input
                  id="np-cap"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={retentionCapPct}
                  onChange={(e) => setRetentionCapPct(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-dlp">DLP (months)</Label>
                <Input
                  id="np-dlp"
                  type="number"
                  min={0}
                  max={120}
                  value={dlpMonths}
                  onChange={(e) => setDlpMonths(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-claim-day">Claim day</Label>
                <Input
                  id="np-claim-day"
                  type="number"
                  min={1}
                  max={31}
                  value={claimDay}
                  onChange={(e) => setClaimDay(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-supervisor">Supervisor (optional)</Label>
              <Select
                value={supervisorId}
                onValueChange={(v) => setSupervisorId(v ?? NONE)}
              >
                <SelectTrigger id="np-supervisor" className="w-full">
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
            <DialogFooter>
              <Button type="submit" disabled={pending || !clientId}>
                {pending ? 'Creating…' : 'Create project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
