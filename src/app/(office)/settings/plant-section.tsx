'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { MoneyInput } from '@/components/MoneyInput'
import { aud } from '@/lib/format'
import { PLANT_OWNERSHIP, type PlantOwnership } from '@/lib/zod'
import { setPlantActive, upsertPlant } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import { PencilIcon, PlusIcon, TruckIcon } from 'lucide-react'

export interface PlantRow {
  id: string
  name: string
  type: string | null
  rego: string | null
  ownership: PlantOwnership
  hourly_rate: number | null
  active: boolean
}

const OWNERSHIP_LABELS: Record<PlantOwnership, string> = {
  owned: 'Owned',
  hired: 'Hired',
}

export function PlantSection({ plant }: { plant: PlantRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Plant and equipment available for diaries and costing.
        </p>
        <PlantDialog />
      </div>
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (r: PlantRow) => (
              <span className="font-medium">{r.name}</span>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            render: (r: PlantRow) => (
              <span className="text-muted-foreground">{r.type ?? '—'}</span>
            ),
          },
          {
            key: 'rego',
            header: 'Rego',
            render: (r: PlantRow) => (
              <span className="text-muted-foreground">{r.rego ?? '—'}</span>
            ),
          },
          {
            key: 'ownership',
            header: 'Ownership',
            render: (r: PlantRow) => (
              <Badge variant="secondary">
                {OWNERSHIP_LABELS[r.ownership] ?? r.ownership}
              </Badge>
            ),
          },
          {
            key: 'hourly_rate',
            header: 'Hourly rate',
            className: 'text-right',
            render: (r: PlantRow) => (
              <span className="block text-right tabular-nums">
                {r.hourly_rate != null ? aud(r.hourly_rate) : '—'}
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: PlantRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: PlantRow) => (
              <div className="flex items-center justify-end gap-1">
                <PlantDialog item={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={r.name}
                  onToggle={(active) => setPlantActive(r.id, active)}
                />
              </div>
            ),
          },
        ]}
        rows={plant}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<TruckIcon className="size-8" />}
            title="No plant yet"
            description="Add plant and equipment to use in site diaries."
          />
        }
      />
    </div>
  )
}

function PlantDialog({ item }: { item?: PlantRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(item?.name ?? '')
  const [type, setType] = useState(item?.type ?? '')
  const [rego, setRego] = useState(item?.rego ?? '')
  const [ownership, setOwnership] = useState<PlantOwnership>(
    item?.ownership ?? 'owned'
  )
  const [hourlyRate, setHourlyRate] = useState<number | null>(
    item?.hourly_rate ?? null
  )

  function reset() {
    if (!item) {
      setName('')
      setType('')
      setRego('')
      setOwnership('owned')
      setHourlyRate(null)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertPlant({
        id: item?.id,
        name,
        type,
        rego,
        ownership,
        hourly_rate: hourlyRate,
        active: item?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(item ? 'Plant updated' : 'Plant added')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      {item ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit plant</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New plant
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{item ? 'Edit plant' : 'New plant'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-name">Name</Label>
              <Input
                id="pl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="5T Excavator"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-type">Type</Label>
                <Input
                  id="pl-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="Excavator"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-rego">Rego</Label>
                <Input
                  id="pl-rego"
                  value={rego}
                  onChange={(e) => setRego(e.target.value)}
                  placeholder="ABC 123"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-ownership">Ownership</Label>
                <Select
                  value={ownership}
                  onValueChange={(v) => setOwnership(v as PlantOwnership)}
                >
                  <SelectTrigger id="pl-ownership" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLANT_OWNERSHIP.map((o) => (
                      <SelectItem key={o} value={o}>
                        {OWNERSHIP_LABELS[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-rate">Hourly rate (AUD)</Label>
                <MoneyInput value={hourlyRate} onChange={setHourlyRate} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : item ? 'Save changes' : 'Add plant'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
