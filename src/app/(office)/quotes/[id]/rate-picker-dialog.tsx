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

/**
 * The matching rates in kind order (the order the kind filter lists them),
 * alphabetical within each kind as they arrive. Only populated kinds appear;
 * a kind the list does not know goes last under its raw name.
 */
function groupByKind(rates: RateItemData[]) {
  const byKind = new Map<string, RateItemData[]>()
  for (const r of rates) {
    const items = byKind.get(r.kind)
    if (items) items.push(r)
    else byKind.set(r.kind, [r])
  }
  const known = PRICE_KINDS.filter((k) => byKind.has(k)).map((k) => ({
    kind: k as string,
    label: KIND_LABELS[k],
    items: byKind.get(k)!,
  }))
  const stray = [...byKind.keys()]
    .filter((k) => !(PRICE_KINDS as readonly string[]).includes(k))
    .map((k) => ({ kind: k, label: k, items: byKind.get(k)! }))
  return [...known, ...stray]
}

/**
 * Pick rates into a section one after another. The dialog stays open after
 * each pick — the search, kind filter and scroll position are untouched — so
 * a run of lines can be added without finding the place again. Every rate
 * picked keeps an "Added" tick until the dialog is next opened, so what has
 * gone in is plain to see. Each pick reports the new line's id through
 * `onAdded` so the section can mark it.
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
  // How many times each rate has been picked since the dialog was opened.
  const [addedTimes, setAddedTimes] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [addedCount, setAddedCount] = useState(0)

  const filtered = rateItems.filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false
    if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase()))
      return false
    return true
  })
  const groups = groupByKind(filtered)

  function handleOpen() {
    setAddedCount(0)
    setAddedTimes(new Map())
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
    setAddedTimes((prev) => new Map(prev).set(rateItemId, (prev.get(rateItemId) ?? 0) + 1))
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
            {groups.length === 0 ? (
              <EmptyState
                title="No matching rates"
                description="Try a different search or kind."
              />
            ) : (
              <ul className="divide-y">
                {groups.map((group) => (
                  <li key={group.kind}>
                    {/* Sticky inside the scroll box, so the kind stays named while scrolling through it. */}
                    <h4 className="sticky top-0 z-10 border-b bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </h4>
                    <ul className="divide-y">
                      {group.items.map((r) => {
                        const adding = addingId === r.id
                        const added = addedTimes.get(r.id) ?? 0
                        return (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => handlePick(r.id)}
                              disabled={addingId !== null}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-wait"
                            >
                              <span className="truncate font-medium">{r.name}</span>
                              {adding ? (
                                <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                              ) : added > 0 ? (
                                <span className="flex shrink-0 items-center gap-1 font-medium text-green-700 dark:text-green-400">
                                  <CheckIcon className="size-4" />
                                  Added{added > 1 ? ` ×${added}` : ''}
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
                  </li>
                ))}
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
