'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MERGE_FIELDS, newBlockId, type DocBlock } from '@/lib/quote-doc'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'

const TYPE_LABELS: Record<DocBlock['type'], string> = {
  text: 'Text',
  bullets: 'Bullet list',
  table: 'Table',
  pricing: 'Pricing',
  acceptance: 'Acceptance',
}

/** Merge-field cheat sheet printed under both editors. */
export function MergeFieldLegend() {
  return (
    <p className="text-xs text-muted-foreground">
      Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}
    </p>
  )
}

function blankBlock(type: DocBlock['type']): DocBlock {
  const id = newBlockId()
  switch (type) {
    case 'text':
      return { id, type, heading: 'New section', body: '' }
    case 'bullets':
      return { id, type, heading: 'New list', items: [] }
    case 'table':
      return { id, type, heading: 'New table', columns: ['Item', 'Detail'], rows: [{ label: '', value: '' }] }
    case 'pricing':
      return { id, type, heading: 'Fee' }
    case 'acceptance':
      return { id, type, heading: 'Acceptance', body: '' }
  }
}

export function DocBlocksEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: DocBlock[]
  onChange: (next: DocBlock[]) => void
  disabled?: boolean
}) {
  const hasAcceptance = value.some((b) => b.type === 'acceptance')

  function update(index: number, next: DocBlock) {
    onChange(value.map((b, i) => (i === index ? next : b)))
  }
  function move(index: number, dir: -1 | 1) {
    const to = index + dir
    if (to < 0 || to >= value.length) return
    const next = [...value]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }
  function add(type: DocBlock['type']) {
    onChange([...value, blankBlock(type)])
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((block, i) => (
        <div key={block.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="shrink-0 font-normal">
              {TYPE_LABELS[block.type]}
            </Badge>
            <Input
              aria-label="Block heading"
              value={block.heading}
              onChange={(e) => update(i, { ...block, heading: e.target.value })}
              disabled={disabled}
              className="h-8"
            />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
              <ArrowUpIcon />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}>
              <ArrowDownIcon />
            </Button>
            {block.type !== 'pricing' && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete block" disabled={disabled} onClick={() => remove(i)}>
                <Trash2Icon />
              </Button>
            )}
          </div>
          <BlockBody block={block} disabled={disabled} onChange={(next) => update(i, next)} />
        </div>
      ))}

      {!disabled && (
        <div className="flex items-center justify-between gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" size="sm" />}
            >
              <PlusIcon />
              Add block
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => add('text')}>Text</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add('bullets')}>Bullet list</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add('table')}>Table</DropdownMenuItem>
              <DropdownMenuItem disabled={hasAcceptance} onClick={() => add('acceptance')}>
                Acceptance
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <MergeFieldLegend />
        </div>
      )}
    </div>
  )
}

function BlockBody({ block, disabled, onChange }: { block: DocBlock; disabled: boolean; onChange: (next: DocBlock) => void }) {
  switch (block.type) {
    case 'text':
      return (
        <Textarea
          aria-label="Body text"
          value={block.body}
          onChange={(e) => onChange({ ...block, body: e.target.value })}
          placeholder="Paragraphs, separated by a blank line"
          rows={4}
          disabled={disabled}
        />
      )
    case 'acceptance':
      return (
        <Textarea
          aria-label="Acceptance text"
          value={block.body}
          onChange={(e) => onChange({ ...block, body: e.target.value })}
          placeholder="Instruction printed above the signature lines"
          rows={3}
          disabled={disabled}
        />
      )
    case 'bullets':
      return (
        <Textarea
          aria-label="Bullet items"
          value={block.items.join('\n')}
          onChange={(e) => onChange({ ...block, items: e.target.value.split('\n') })}
          placeholder="One item per line"
          rows={4}
          disabled={disabled}
        />
      )
    case 'pricing':
      return (
        <Textarea
          aria-label="Pricing note"
          value={block.note ?? ''}
          onChange={(e) => onChange({ ...block, note: e.target.value })}
          placeholder="Sentence printed under the fee (optional). The price itself comes from the quote."
          rows={2}
          disabled={disabled}
        />
      )
    case 'table':
      return (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="Table intro"
            value={block.intro ?? ''}
            onChange={(e) => onChange({ ...block, intro: e.target.value })}
            placeholder="Paragraph above the table (optional)"
            rows={2}
            disabled={disabled}
          />
          <div className="grid grid-cols-[30%_1fr_auto] gap-2">
            <Input aria-label="Column 1 heading" value={block.columns[0]} onChange={(e) => onChange({ ...block, columns: [e.target.value, block.columns[1]] })} disabled={disabled} className="h-8 font-medium" />
            <Input aria-label="Column 2 heading" value={block.columns[1]} onChange={(e) => onChange({ ...block, columns: [block.columns[0], e.target.value] })} disabled={disabled} className="h-8 font-medium" />
            <span />
            {block.rows.map((row, r) => (
              <React.Fragment key={r}>
                <Input
                  aria-label={`Row ${r + 1} label`}
                  value={row.label}
                  onChange={(e) => onChange({ ...block, rows: block.rows.map((x, j) => (j === r ? { ...x, label: e.target.value } : x)) })}
                  disabled={disabled}
                  className="h-8"
                />
                <Textarea
                  aria-label={`Row ${r + 1} value`}
                  value={row.value}
                  onChange={(e) => onChange({ ...block, rows: block.rows.map((x, j) => (j === r ? { ...x, value: e.target.value } : x)) })}
                  disabled={disabled}
                  rows={1}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete row ${r + 1}`} disabled={disabled} onClick={() => onChange({ ...block, rows: block.rows.filter((_, j) => j !== r) })}>
                  <Trash2Icon />
                </Button>
              </React.Fragment>
            ))}
          </div>
          {!disabled && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange({ ...block, rows: [...block.rows, { label: '', value: '' }] })}>
              <PlusIcon />
              Add row
            </Button>
          )}
        </div>
      )
  }
}
