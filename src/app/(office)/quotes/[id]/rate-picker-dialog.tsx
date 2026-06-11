'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { aud, pct } from '@/lib/format'
import { lineSell } from '@/lib/money'
import { RATE_KINDS, type RateKind } from '@/lib/zod'
import { addLine } from '../actions'
import type { RateItemData } from './quote-builder'
import { BookOpenIcon, SearchIcon } from 'lucide-react'

const KIND_LABELS: Record<RateKind, string> = {
  labour: 'Labour',
  plant: 'Plant',
  material: 'Material',
  subbie: 'Subbie',
  other: 'Other',
}

export function RatePickerDialog({
  quoteId,
  sectionId,
  rateItems,
}: {
  quoteId: string
  sectionId: string
  rateItems: RateItemData[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | RateKind>('all')

  const filtered = rateItems.filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false
    if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase()))
      return false
    return true
  })

  function handlePick(rateItemId: string) {
    startTransition(async () => {
      const result = await addLine({
        quote_id: quoteId,
        section_id: sectionId,
        rate_item_id: rateItemId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Line added from rates')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BookOpenIcon />
        Add from rates
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add from rate library</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rates…"
                className="pl-8"
                autoFocus
              />
            </div>
            <Select value={kind} onValueChange={(v) => setKind(v as 'all' | RateKind)}>
              <SelectTrigger className="w-32">
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
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            {filtered.length === 0 ? (
              <EmptyState
                title="No matching rates"
                description="Try a different search or kind."
              />
            ) : (
              <ul className="divide-y">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(r.id)}
                      disabled={pending}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge variant="secondary" className="shrink-0">
                          {KIND_LABELS[r.kind as RateKind] ?? r.kind}
                        </Badge>
                        <span className="truncate font-medium">{r.name}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                        {aud(r.cost)} / {r.unit} @ {pct(r.default_markup_pct)} →{' '}
                        <span className="font-medium text-foreground">
                          {aud(lineSell(r.cost, r.default_markup_pct))}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
