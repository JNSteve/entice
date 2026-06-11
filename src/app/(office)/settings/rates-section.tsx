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
import { aud, pct } from '@/lib/format'
import { RATE_KINDS, type RateKind } from '@/lib/zod'
import { setRateItemActive, upsertRateItem } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import { ListIcon, PencilIcon, PlusIcon } from 'lucide-react'

export interface RateItemRow {
  id: string
  kind: RateKind
  name: string
  unit: string
  cost: number
  default_markup_pct: number
  active: boolean
}

const KIND_LABELS: Record<RateKind, string> = {
  labour: 'Labour',
  plant: 'Plant',
  material: 'Material',
  subbie: 'Subbie',
  other: 'Other',
}

export function RatesSection({ rateItems }: { rateItems: RateItemRow[] }) {
  const [kindFilter, setKindFilter] = useState<'all' | RateKind>('all')

  const filtered =
    kindFilter === 'all'
      ? rateItems
      : rateItems.filter((r) => r.kind === kindFilter)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Select
          value={kindFilter}
          onValueChange={(v) => setKindFilter(v as 'all' | RateKind)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {RATE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RateItemDialog />
      </div>
      <DataTable
        columns={[
          {
            key: 'kind',
            header: 'Kind',
            render: (r: RateItemRow) => (
              <Badge variant="secondary">{KIND_LABELS[r.kind] ?? r.kind}</Badge>
            ),
          },
          {
            key: 'name',
            header: 'Name',
            render: (r: RateItemRow) => (
              <span className="font-medium">{r.name}</span>
            ),
          },
          {
            key: 'unit',
            header: 'Unit',
            render: (r: RateItemRow) => (
              <span className="text-muted-foreground">{r.unit}</span>
            ),
          },
          {
            key: 'cost',
            header: 'Cost',
            className: 'text-right',
            render: (r: RateItemRow) => (
              <span className="block text-right tabular-nums">{aud(r.cost)}</span>
            ),
          },
          {
            key: 'markup',
            header: 'Markup',
            className: 'text-right',
            render: (r: RateItemRow) => (
              <span className="block text-right tabular-nums">
                {pct(r.default_markup_pct)}
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: RateItemRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: RateItemRow) => (
              <div className="flex items-center justify-end gap-1">
                <RateItemDialog item={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={r.name}
                  onToggle={(active) => setRateItemActive(r.id, active)}
                />
              </div>
            ),
          },
        ]}
        rows={filtered}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<ListIcon className="size-8" />}
            title={
              kindFilter === 'all'
                ? 'No rate items yet'
                : `No ${KIND_LABELS[kindFilter as RateKind].toLowerCase()} rates yet`
            }
            description="Add rate items to speed up quoting."
          />
        }
      />
    </div>
  )
}

function RateItemDialog({ item }: { item?: RateItemRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [kind, setKind] = useState<RateKind>(item?.kind ?? 'labour')
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState(item?.unit ?? 'ea')
  const [cost, setCost] = useState<number | null>(item?.cost ?? null)
  const [markup, setMarkup] = useState(String(item?.default_markup_pct ?? 20))

  function reset() {
    if (!item) {
      setKind('labour')
      setName('')
      setUnit('ea')
      setCost(null)
      setMarkup('20')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertRateItem({
        id: item?.id,
        kind,
        name,
        unit,
        cost: cost ?? 0,
        default_markup_pct: markup,
        active: item?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(item ? 'Rate item updated' : 'Rate item added')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      {item ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit rate item</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New rate item
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{item ? 'Edit rate item' : 'New rate item'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ri-kind">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RateKind)}>
                <SelectTrigger id="ri-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ri-name">Name</Label>
              <Input
                id="ri-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Labourer — standard"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ri-unit">Unit</Label>
                <Input
                  id="ri-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="hr"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ri-cost">Cost (AUD)</Label>
                <MoneyInput value={cost} onChange={setCost} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ri-markup">Markup %</Label>
                <Input
                  id="ri-markup"
                  type="number"
                  min={0}
                  max={1000}
                  step="0.01"
                  value={markup}
                  onChange={(e) => setMarkup(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : item ? 'Save changes' : 'Add rate item'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
