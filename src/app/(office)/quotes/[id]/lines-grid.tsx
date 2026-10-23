'use client'

import React, { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { aud } from '@/lib/format'
import { duplicateLineIds, groupLinesByKind } from '@/lib/quote-lines'
import { cn } from '@/lib/utils'
import type { RateKind } from '@/lib/zod'
import { addLine } from '../actions'
import {
  LineRow,
  LINE_GRID_COLS_EDITABLE,
  LINE_GRID_COLS_READONLY,
  type LineData,
} from './line-row'
import { PlusIcon } from 'lucide-react'

/**
 * A section's lines grouped by cost category — Labour, Plant & equipment,
 * Materials, Subcontract, Other, then Uncategorised. Only populated groups
 * render. Each group heading carries the group's sell subtotal and, on an
 * editable quote with a real section, an "Add line" that creates a line
 * already in that category. Orphaned lines (sectionId null — their section
 * was deleted) get no add buttons because addLine needs a section.
 */
export function LinesGrid({
  quoteId,
  sectionId,
  lines,
  editable,
  freshIds,
  onLineEdited,
}: {
  quoteId: string
  sectionId: string | null
  lines: LineData[]
  editable: boolean
  /** Lines just added from the rate library, tinted until each is edited or locked. */
  freshIds?: ReadonlySet<string>
  onLineEdited?: (lineId: string) => void
}) {
  if (lines.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No lines yet.</p>
  }

  const groups = groupLinesByKind(lines)
  // Same rate or same wording twice in this section: tinted blue to be checked.
  const duplicates = duplicateLineIds(lines)

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'hidden gap-2 px-1 text-xs font-medium text-muted-foreground md:grid',
          editable ? LINE_GRID_COLS_EDITABLE : LINE_GRID_COLS_READONLY
        )}
      >
        {/* A real cell, so the padlock column lines up: sr-only alone is
            absolutely positioned and would take no grid slot. */}
        {editable && (
          <span>
            <span className="sr-only">Lock</span>
          </span>
        )}
        <span>Description</span>
        <span>Category</span>
        <span className="text-right">Qty</span>
        <span>Unit</span>
        <span className="text-right">Unit cost</span>
        <span className="text-right">Markup %</span>
        <span className="text-right">Unit sell</span>
        <span className="text-right">Total</span>
        {editable && <span className="sr-only">Actions</span>}
      </div>

      {groups.map((group) => (
        <div
          key={group.kind ?? 'uncategorised'}
          role="group"
          aria-label={group.label}
          className="flex flex-col gap-1.5"
        >
          <div className="mt-1 flex items-center justify-between gap-2 border-b px-1 pb-1">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h4>
              {editable && sectionId && (
                <AddGroupLineButton
                  quoteId={quoteId}
                  sectionId={sectionId}
                  kind={group.kind}
                  label={group.label}
                />
              )}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {aud(group.sellSubtotal)}
            </span>
          </div>
          {group.lines.map((line, i) => (
            <LineRow
              key={line.id}
              line={line}
              editable={editable}
              isFirst={i === 0}
              isLast={i === group.lines.length - 1}
              highlighted={freshIds?.has(line.id) ?? false}
              duplicate={duplicates.has(line.id)}
              onEdited={onLineEdited ? () => onLineEdited(line.id) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function AddGroupLineButton({
  quoteId,
  sectionId,
  kind,
  label,
}: {
  quoteId: string
  sectionId: string
  kind: RateKind | null
  label: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleAdd() {
    startTransition(async () => {
      const result = await addLine({
        quote_id: quoteId,
        section_id: sectionId,
        ...(kind ? { kind } : {}),
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-xs"
      onClick={handleAdd}
      disabled={pending}
    >
      <PlusIcon />
      Add line{' '}
      <span className="sr-only">to {label}</span>
    </Button>
  )
}
