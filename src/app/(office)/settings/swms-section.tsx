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
import { Textarea } from '@/components/ui/textarea'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import {
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  type RiskLevel,
  type SwmsHazard,
} from '@/lib/zod'
import { setSwmsTemplateActive, upsertSwmsTemplate } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react'

export interface SwmsTemplateRow {
  id: string
  title: string
  body: string | null
  hazards: SwmsHazard[]
  version: number
  active: boolean
}

export function SwmsSection({ templates }: { templates: SwmsTemplateRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Safe work method statement templates applied to projects and jobs.
        </p>
        <SwmsTemplateDialog />
      </div>
      <DataTable
        columns={[
          {
            key: 'title',
            header: 'Title',
            render: (r: SwmsTemplateRow) => (
              <span className="font-medium">{r.title}</span>
            ),
          },
          {
            key: 'hazards',
            header: 'Hazards',
            render: (r: SwmsTemplateRow) => (
              <span className="text-muted-foreground tabular-nums">
                {r.hazards.length} {r.hazards.length === 1 ? 'row' : 'rows'}
              </span>
            ),
          },
          {
            key: 'version',
            header: 'Version',
            render: (r: SwmsTemplateRow) => (
              <Badge variant="secondary" className="tabular-nums">
                v{r.version}
              </Badge>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: SwmsTemplateRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: SwmsTemplateRow) => (
              <div className="flex items-center justify-end gap-1">
                <SwmsTemplateDialog template={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={r.title}
                  onToggle={(active) => setSwmsTemplateActive(r.id, active)}
                />
              </div>
            ),
          },
        ]}
        rows={templates}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<ShieldCheckIcon className="size-8" />}
            title="No SWMS templates yet"
            description="Create a template so SWMS can be issued to projects and jobs."
          />
        }
      />
    </div>
  )
}

// ─── Editor dialog ────────────────────────────────────────────────────────────

const EMPTY_HAZARD: SwmsHazard = {
  task: '',
  hazards: '',
  risk: 'M',
  controls: '',
  residual_risk: 'L',
}

function SwmsTemplateDialog({ template }: { template?: SwmsTemplateRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState(template?.title ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [hazards, setHazards] = useState<SwmsHazard[]>(
    template?.hazards.length ? template.hazards : [{ ...EMPTY_HAZARD }]
  )

  function reset() {
    if (!template) {
      setTitle('')
      setBody('')
      setHazards([{ ...EMPTY_HAZARD }])
    }
  }

  function setHazard(index: number, patch: Partial<SwmsHazard>) {
    setHazards((prev) =>
      prev.map((h, i) => (i === index ? { ...h, ...patch } : h))
    )
  }

  function addHazard() {
    setHazards((prev) => [...prev, { ...EMPTY_HAZARD }])
  }

  function removeHazard(index: number) {
    setHazards((prev) =>
      prev.length === 1 ? [{ ...EMPTY_HAZARD }] : prev.filter((_, i) => i !== index)
    )
  }

  function moveHazard(index: number, direction: -1 | 1) {
    setHazards((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertSwmsTemplate({
        id: template?.id,
        title,
        body,
        hazards,
        active: template?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(template ? 'SWMS template updated' : 'SWMS template created')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      {template ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit SWMS template</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New template
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {template ? `Edit SWMS template (v${template.version})` : 'New SWMS template'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-title">Title</Label>
              <Input
                id="st-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Excavation deeper than 1.5m"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-body">Safe work method</Label>
              <Textarea
                id="st-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the safe work method"
                rows={5}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Hazards</Label>
              <div className="flex flex-col gap-3">
                {hazards.map((h, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Row {i + 1}
                      </span>
                      <span className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => moveHazard(i, -1)}
                          disabled={i === 0}
                        >
                          <ArrowUpIcon />
                          <span className="sr-only">Move up</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => moveHazard(i, 1)}
                          disabled={i === hazards.length - 1}
                        >
                          <ArrowDownIcon />
                          <span className="sr-only">Move down</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeHazard(i)}
                        >
                          <XIcon />
                          <span className="sr-only">Remove row</span>
                        </Button>
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={h.task}
                        onChange={(e) => setHazard(i, { task: e.target.value })}
                        placeholder="Task / activity"
                        required
                      />
                      <Input
                        value={h.hazards}
                        onChange={(e) => setHazard(i, { hazards: e.target.value })}
                        placeholder="Hazards"
                        required
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_minmax(0,2fr)_1fr]">
                      <RiskSelect
                        value={h.risk}
                        onChange={(risk) => setHazard(i, { risk })}
                        label="Risk"
                      />
                      <Input
                        value={h.controls}
                        onChange={(e) => setHazard(i, { controls: e.target.value })}
                        placeholder="Controls"
                        required
                      />
                      <RiskSelect
                        value={h.residual_risk}
                        onChange={(residual_risk) => setHazard(i, { residual_risk })}
                        label="Residual"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addHazard}
                className="self-start"
              >
                <PlusIcon />
                Add hazard row
              </Button>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : template
                    ? 'Save changes'
                    : 'Create template'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RiskSelect({
  value,
  onChange,
  label,
}: {
  value: RiskLevel
  onChange: (value: RiskLevel) => void
  label: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RiskLevel)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RISK_LEVELS.map((r) => (
          <SelectItem key={r} value={r}>
            {label}: {RISK_LEVEL_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
