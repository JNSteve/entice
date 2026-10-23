'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { PRICE_KIND_LABELS, PRICE_KINDS, type PriceKind } from '@/lib/price-list'
import { addLine } from '../actions'
import type { RateItemData } from './quote-builder'
import { BookOpenIcon, CheckIcon, Loader2Icon, SearchIcon } from 'lucide-react'

const KIND_LABELS = PRICE_KIND_LABELS

/** How long the picked row keeps its "Added" tick. */
const ADDED_TICK_MS = 1500

/**
 * Pick rates into a section one after another. The dialog stays open after
 * each pick — the search, kind filter and scroll position are untouched — so
 * a run of lines can be added without finding the place again. Each pick
 * reports the new line's id through `onAdded` so the section can mark it.
 */
export function RatePickerDialog({
  quoteId,
  sectionId,
  rateItems,
  onAdded,
}: {
  quoteId: string
  sectionId: string
  rateItems: RateItemData[]
  onAdded?: (lineId: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | PriceKind>('all')
  // One add at a time, so each line lands after the last; this row spins.
  const [addingId, setAddingId] = useState<string | null>(null)
  // The last pick keeps a tick for a moment so the click is visibly confirmed.
  // `n` makes picking the same rate twice restart the timer.
  const [justAdded, setJustAdded] = useState<{ id: string; n: number } | null>(null)
  const [addedCount, setAddedCount] = useState(0)

  useEffect(() => {
    if (!justAdded) return
    const timer = setTimeout(() => setJustAdded(null), ADDED_TICK_MS)
    return () => clearTimeout(timer)
  }, [justAdded])

  const filtered = rateItems.filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false
    if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase()))
      return false
    return true
  })

  function handleOpen() {
    setAddedCount(0)
    setJustAdded(null)
    setOpen(true)
  }

  async function handlePick(rateItemId: string) {
    if (addingId) return
    setAddingId(rateItemId)
    const result = await addLine({
      quote_id: quoteId,
      section_id: sectionId,
      rate_item_id: rateItemId,
    })
    setAddingId(null)
    if (result.error || !result.id) {
      toast.error(result.error ?? 'Could not add the line')
      return
    }
    setAddedCount((n) => n + 1)
    setJustAdded((prev) => ({ id: rateItemId, n: (prev?.n ?? 0) + 1 }))
    onAdded?.(result.id)
    // The quote behind the dialog picks the line up; the list is not blocked on it.
    startTransition(() => router.refresh())
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
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
            <Select value={kind} onValueChange={(v) => setKind(v as 'all' | PriceKind)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                {PRICE_KINDS.map((k) => (
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
                {filtered.map((r) => {
                  const adding = addingId === r.id
                  const added = justAdded?.id === r.id
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(r.id)}
                        disabled={addingId !== null}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-wait"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge variant="secondary" className="shrink-0">
                            {KIND_LABELS[r.kind as PriceKind] ?? r.kind}
                          </Badge>
                          <span className="truncate font-medium">{r.name}</span>
                        </span>
                        {adding ? (
                          <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : added ? (
                          <span className="flex shrink-0 items-center gap-1 font-medium text-green-700 dark:text-green-400">
                            <CheckIcon className="size-4" />
                            Added
                          </span>
                        ) : (
                          <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                            {aud(r.cost)} / {r.unit} @ {pct(r.default_markup_pct)} →{' '}
                            <span className="font-medium text-foreground">
                              {aud(lineSell(r.cost, r.default_markup_pct))}
                            </span>
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {addedCount === 0
                ? 'Pick a rate to add it to this section.'
                : `${addedCount} added`}
            </span>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
