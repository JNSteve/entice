'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon, SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { aud } from '@/lib/format'
import type { PriceKind } from '@/lib/price-list'
import { searchPriceItems, type PriceItemHit } from '@/lib/price-list-actions'

/** Search the price list (server-side) for items of the given kinds. */
export function ItemSearch({
  kinds,
  onPick,
  onCustom,
}: {
  kinds: PriceKind[]
  onPick: (item: PriceItemHit) => void
  onCustom: () => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PriceItemHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const kindKey = kinds.join(',')

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      const res = await searchPriceItems(query, kindKey.split(',') as PriceKind[])
      if (!cancelled) {
        setItems(res.items)
        setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, kindKey])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the price list — name, code or supplier"
          className="pl-8"
          aria-label="Search the price list"
          autoFocus
        />
        {loading && (
          <Loader2Icon className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
        {items?.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onPick(it)}
              className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block truncate">{it.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[it.supplier, it.product_code].filter(Boolean).join(' · ') || 'No supplier'}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {aud(it.cost)} / {it.unit}
              </span>
            </button>
          </li>
        ))}
        {items && items.length === 0 && (
          <li className="px-3 py-2 text-muted-foreground">
            {query.trim() ? 'Nothing matches.' : 'No items of this type in the price list yet.'}
          </li>
        )}
        <li>
          <button type="button" onClick={onCustom} className="w-full px-3 py-2 text-left text-muted-foreground hover:bg-muted">
            Custom item — not in the price list
          </button>
        </li>
      </ul>
    </div>
  )
}
