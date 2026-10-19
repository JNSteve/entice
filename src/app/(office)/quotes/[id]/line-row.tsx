'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/MoneyInput'
import { aud } from '@/lib/format'
import { lineMarkup, lineSell, lineTotal } from '@/lib/money'
import { LINE_KIND_LABELS, LINE_KIND_ORDER, lineKindLabel } from '@/lib/quote-lines'
import { cn } from '@/lib/utils'
import type { RateKind } from '@/lib/zod'
import { deleteLine, moveLine, updateLine } from '../actions'
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react'

export interface LineData {
  id: string
  section_id: string | null
  position: number
  description: string
  qty: number
  unit: string
  unit_cost: number
  markup_pct: number
  unit_sell: number
  /** Cost category from the source rate item; null for untagged manual lines. */
  kind: string | null
}

export const LINE_GRID_COLS_EDITABLE =
  'grid-cols-[minmax(10rem,1fr)_10rem_4.5rem_4rem_7rem_5rem_7rem_6.5rem_5.5rem]'
export const LINE_GRID_COLS_READONLY =
  'grid-cols-[minmax(10rem,1fr)_10rem_4.5rem_4rem_7rem_5rem_7rem_6.5rem]'

interface LinePayload {
  description: string
  qty: number
  unit: string
  unit_cost: number
  markup_pct: number
  unit_sell: number
  sell_overridden: boolean
  /** Cost category; null = uncategorised. */
  kind: RateKind | null
}

export function LineRow({
  line,
  editable,
  isFirst,
  isLast,
}: {
  line: LineData
  editable: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Optimistic local state — saved per-field on blur, refreshed from server after.
  const [description, setDescription] = useState(line.description)
  const [qty, setQty] = useState(String(line.qty))
  const [unit, setUnit] = useState(line.unit)
  const [cost, setCost] = useState<number>(line.unit_cost)
  const [markup, setMarkup] = useState(String(line.markup_pct))
  const [sell, setSell] = useState<number>(line.unit_sell)
  const [kind, setKind] = useState<RateKind | null>((line.kind as RateKind | null) ?? null)
  // Cost and sell are what gets typed; markup is derived from them, so editing
  // either one re-derives the markup and leaves the other alone. Typing a
  // markup directly is the exception: that sets the sell from the cost. A sell
  // is only an "override" when no 2dp markup can reproduce it (or when the
  // cost is 0) — then the typed sell is kept as-is until the markup is edited.
  const [overridden, setOverridden] = useState(
    () => line.unit_sell !== lineSell(line.unit_cost, line.markup_pct)
  )

  function revert() {
    setDescription(line.description)
    setQty(String(line.qty))
    setUnit(line.unit)
    setCost(line.unit_cost)
    setMarkup(String(line.markup_pct))
    setSell(line.unit_sell)
    setKind((line.kind as RateKind | null) ?? null)
    setOverridden(line.unit_sell !== lineSell(line.unit_cost, line.markup_pct))
  }

  function save(overrides: Partial<LinePayload> = {}) {
    const payload: LinePayload = {
      description,
      qty: parseFloat(qty) || 0,
      unit: unit.trim() || 'ea',
      unit_cost: cost,
      markup_pct: parseFloat(markup) || 0,
      unit_sell: sell,
      sell_overridden: overridden,
      kind,
      ...overrides,
    }
    startTransition(async () => {
      const result = await updateLine(line.id, payload)
      if (result.error) {
        toast.error(result.error)
        revert()
        return
      }
      router.refresh()
    })
  }

  /** Markup that takes `c` to `s`, falling back to the current markup when there's no cost. */
  function deriveMarkup(c: number, s: number) {
    const pct = lineMarkup(c, s) ?? (parseFloat(markup) || 0)
    return { markup: pct, overridden: s !== lineSell(c, pct) }
  }

  function handleCostChange(v: number | null) {
    const newCost = v ?? 0
    if (newCost === cost) return
    if (sell === 0) {
      // Nothing quoted yet: seed the sell from the markup, as a fresh line would.
      const newSell = lineSell(newCost, parseFloat(markup) || 0)
      setCost(newCost)
      setSell(newSell)
      setOverridden(false)
      save({ unit_cost: newCost, unit_sell: newSell, sell_overridden: false })
      return
    }
    // The sell is the quoted price: hold it and let the markup absorb the change.
    const next = deriveMarkup(newCost, sell)
    setCost(newCost)
    setMarkup(String(next.markup))
    setOverridden(next.overridden)
    save({ unit_cost: newCost, markup_pct: next.markup, sell_overridden: next.overridden })
  }

  function handleMarkupBlur() {
    const newMarkup = parseFloat(markup) || 0
    if (newMarkup === line.markup_pct && String(newMarkup) === markup) return
    setMarkup(String(newMarkup))
    const newSell = lineSell(cost, newMarkup)
    setSell(newSell)
    setOverridden(false)
    save({ markup_pct: newMarkup, unit_sell: newSell, sell_overridden: false })
  }

  function handleSellChange(v: number | null) {
    const newSell = v ?? 0
    if (newSell === sell) return
    const next = deriveMarkup(cost, newSell)
    setSell(newSell)
    setMarkup(String(next.markup))
    setOverridden(next.overridden)
    save({ unit_sell: newSell, markup_pct: next.markup, sell_overridden: next.overridden })
  }

  function handleKindChange(value: string) {
    const next = (value || null) as RateKind | null
    if (next === kind) return
    setKind(next)
    save({ kind: next })
  }

  function handleMove(dir: 'up' | 'down') {
    startTransition(async () => {
      const result = await moveLine(line.id, dir)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleDelete() {
    if (!confirm('Delete this line?')) return
    startTransition(async () => {
      const result = await deleteLine(line.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  const qtyNumber = parseFloat(qty) || 0
  const total = lineTotal(qtyNumber, sell)

  if (!editable) {
    return (
      <div
        className={cn(
          'grid items-center gap-2 rounded-md px-1 py-1 text-sm',
          LINE_GRID_COLS_READONLY
        )}
      >
        <span className="truncate">{description || '—'}</span>
        <span className="truncate text-muted-foreground">
          {line.kind ? lineKindLabel(line.kind) : '—'}
        </span>
        <span className="text-right tabular-nums">{line.qty}</span>
        <span className="text-muted-foreground">{unit}</span>
        <span className="text-right tabular-nums">{aud(cost)}</span>
        <span className="text-right tabular-nums">{markup}%</span>
        <span className="text-right tabular-nums">{aud(sell)}</span>
        <span className="text-right font-medium tabular-nums">{aud(total)}</span>
      </div>
    )
  }

  return (
    <div className={cn('grid items-center gap-2', LINE_GRID_COLS_EDITABLE)}>
      <Input
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== line.description) save({ description })
        }}
        placeholder="Line description…"
      />
      <select
        aria-label="Category"
        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-base shadow-xs md:text-sm"
        value={kind ?? ''}
        onChange={(e) => handleKindChange(e.target.value)}
      >
        <option value="">{LINE_KIND_LABELS.uncategorised}</option>
        {LINE_KIND_ORDER.map((k) => (
          <option key={k} value={k}>
            {LINE_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <Input
        aria-label="Quantity"
        type="number"
        min={0}
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={(e) => {
          const n = parseFloat(e.target.value) || 0
          if (n !== line.qty) save({ qty: n })
        }}
        className="text-right tabular-nums"
      />
      <Input
        aria-label="Unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => {
          if (unit.trim() && unit !== line.unit) save({ unit: unit.trim() })
          else if (!unit.trim()) setUnit(line.unit)
        }}
      />
      <MoneyInput aria-label="Unit cost" value={cost} onChange={handleCostChange} />
      <Input
        aria-label="Markup %"
        type="number"
        step="0.01"
        value={markup}
        onChange={(e) => setMarkup(e.target.value)}
        onBlur={handleMarkupBlur}
        className="text-right tabular-nums"
      />
      <MoneyInput aria-label="Unit sell" value={sell} onChange={handleSellChange} />
      <span className="px-1 text-right text-sm font-medium tabular-nums">
        {aud(total)}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleMove('up')}
          disabled={pending || isFirst}
        >
          <ArrowUpIcon />
          <span className="sr-only">Move line up</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleMove('down')}
          disabled={pending || isLast}
        >
          <ArrowDownIcon />
          <span className="sr-only">Move line down</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          disabled={pending}
        >
          <Trash2Icon className="text-destructive" />
          <span className="sr-only">Delete line</span>
        </Button>
      </div>
    </div>
  )
}
