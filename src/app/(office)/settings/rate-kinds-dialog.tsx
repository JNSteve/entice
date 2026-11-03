'use client'

import React, { useRef, useState, useTransition } from 'react'
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
import { Label } from '@/components/ui/label'
import { sortRateKinds, type RateKindRow } from '@/lib/rate-kinds'
import { createRateKind, deleteRateKind, renameRateKind } from './actions'
import { CheckIcon, PencilIcon, PlusIcon, TagsIcon, Trash2Icon } from 'lucide-react'

/**
 * Settings → Rates → Categories: the rate_kinds catalog. Built-ins can be
 * relabelled but not removed (code maps their keys to P&L categories and
 * Xero accounts); a custom category can be removed while nothing uses it,
 * and the server says so when something still does.
 */
export function RateKindsDialog({ rateKinds }: { rateKinds: readonly RateKindRow[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [label, setLabel] = useState('')

  const rows = sortRateKinds(rateKinds)

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = label.trim()
    if (!name) return
    startTransition(async () => {
      const result = await createRateKind({ label: name })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Added ${name}`)
      setLabel('')
      router.refresh()
    })
  }

  function handleDelete(row: RateKindRow) {
    startTransition(async () => {
      const result = await deleteRateKind(row.key)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Removed ${row.label}`)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <TagsIcon />
        Categories
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rate categories</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Categories group rates, quote lines and invoice lines. Built-in ones can be
            renamed but not removed; a custom one can be removed while nothing uses it.
          </p>
          <ul className="divide-y rounded-md border" aria-label="Rate categories">
            {rows.map((row) => (
              <KindRow
                key={row.key}
                row={row}
                disabled={pending}
                onDelete={() => handleDelete(row)}
              />
            ))}
          </ul>
          <form onSubmit={handleAdd} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="rk-new">New category</Label>
              <Input
                id="rk-new"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Waste disposal"
                maxLength={40}
              />
            </div>
            <Button type="submit" disabled={pending || !label.trim()}>
              <PlusIcon />
              Add
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function KindRow({
  row,
  disabled,
  onDelete,
}: {
  row: RateKindRow
  disabled: boolean
  onDelete: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(row.label)
  // Enter submits and the field also blurs: one rename per edit, not two.
  const busy = useRef(false)
  const cancelled = useRef(false)

  function commit() {
    if (busy.current) return
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = label.trim()
    if (!next || next === row.label) {
      setLabel(row.label)
      setEditing(false)
      return
    }
    busy.current = true
    startTransition(async () => {
      const result = await renameRateKind({ key: row.key, label: next })
      if (result.error) {
        toast.error(result.error)
        setLabel(row.label)
      } else {
        router.refresh()
      }
      busy.current = false
      setEditing(false)
    })
  }

  function cancel() {
    cancelled.current = true
    setLabel(row.label)
    setEditing(false)
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
          className="flex flex-1 items-center gap-2"
        >
          <Input
            aria-label={`Rename ${row.label}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
            }}
            autoFocus
            maxLength={40}
            className="h-8"
          />
          <Button type="submit" size="icon-sm" variant="ghost" disabled={pending}>
            <CheckIcon />
            <span className="sr-only">Save</span>
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 font-medium">{row.label}</span>
          {row.builtin && <Badge variant="secondary">Built-in</Badge>}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={disabled || pending}
          >
            <PencilIcon />
            <span className="sr-only">{`Rename ${row.label}`}</span>
          </Button>
          {!row.builtin && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-destructive"
              onClick={onDelete}
              disabled={disabled || pending}
            >
              <Trash2Icon />
              <span className="sr-only">{`Delete ${row.label}`}</span>
            </Button>
          )}
        </>
      )}
    </li>
  )
}
