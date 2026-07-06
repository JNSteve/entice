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
import { RISK_LEVELS, RISK_LEVEL_LABELS, type RiskLevel } from '@/lib/zod'
import {
  DEFAULT_HRCW_ITEMS,
  HRCW_ANSWERS,
  HRCW_ANSWER_LABELS,
  newHrcwItemId,
  parseDocControl,
  parseEmergencyScenarios,
  parseHrcwItems,
  parseRequirements,
  parseSteps,
  parseStringList,
  type HrcwAnswer,
  type SwmsDocControl,
  type SwmsEmergencyScenario,
  type SwmsHrcwItem,
  type SwmsRequirements,
  type SwmsStep,
} from '@/lib/swms'
import { setSwmsTemplateActive, upsertSwmsTemplate } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react'

export interface SwmsTemplateRow {
  id: string
  title: string
  version: number
  active: boolean
  body?: string | null
  hazards?: unknown
  doc_control?: unknown
  hrcw_items?: unknown
  requirements?: unknown
  steps?: unknown
  stop_work_triggers?: unknown
  emergency_scenarios?: unknown
  references_list?: unknown
}

export function SwmsSection({ templates }: { templates: SwmsTemplateRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Safe work method statement templates applied to projects and jobs.
          Project-specific details and HRCW answers are captured when a SWMS is
          issued.
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
            key: 'steps',
            header: 'Work steps',
            render: (r: SwmsTemplateRow) => {
              const count = parseSteps(r.steps).length
              return (
                <span className="text-muted-foreground tabular-nums">
                  {count} {count === 1 ? 'step' : 'steps'}
                </span>
              )
            },
          },
          {
            key: 'hrcw',
            header: 'HRCW items',
            render: (r: SwmsTemplateRow) => (
              <span className="text-muted-foreground tabular-nums">
                {parseHrcwItems(r.hrcw_items).length}
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

const EMPTY_STEP: SwmsStep = {
  step: '',
  hazards: '',
  initial_risk: 'M',
  controls: '',
  residual_risk: 'L',
  responsible: '',
}

const EMPTY_SCENARIO: SwmsEmergencyScenario = {
  scenario: '',
  immediate_action: '',
  notification: '',
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SwmsTemplateDialog({ template }: { template?: SwmsTemplateRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const initialDocControl = parseDocControl(template?.doc_control)
  if (initialDocControl.scope_note.trim() === '' && template?.body) {
    initialDocControl.scope_note = template.body
  }
  const initialSteps = parseSteps(template?.steps)

  const [title, setTitle] = useState(template?.title ?? '')
  const [docControl, setDocControl] = useState<SwmsDocControl>(initialDocControl)
  const [steps, setSteps] = useState<SwmsStep[]>(
    initialSteps.length ? initialSteps : [{ ...EMPTY_STEP }]
  )
  const [hrcwItems, setHrcwItems] = useState<SwmsHrcwItem[]>(
    parseHrcwItems(template?.hrcw_items)
  )
  const [requirements, setRequirements] = useState<SwmsRequirements>(
    parseRequirements(template?.requirements)
  )
  const [stopWorkText, setStopWorkText] = useState(
    parseStringList(template?.stop_work_triggers).join('\n')
  )
  const [scenarios, setScenarios] = useState<SwmsEmergencyScenario[]>(
    parseEmergencyScenarios(template?.emergency_scenarios)
  )
  const [referencesText, setReferencesText] = useState(
    parseStringList(template?.references_list).join('\n')
  )

  function reset() {
    if (!template) {
      setTitle('')
      setDocControl({ prepared_by: '', approved_by: '', scope_note: '' })
      setSteps([{ ...EMPTY_STEP }])
      setHrcwItems([])
      setRequirements({
        competency: '',
        licences_permits: '',
        ppe: '',
        equipment: '',
        monitoring: '',
      })
      setStopWorkText('')
      setScenarios([])
      setReferencesText('')
    }
  }

  // ── Steps table helpers ────────────────────────────────────────────────────

  function setStep(index: number, patch: Partial<SwmsStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addStep() {
    setSteps((prev) => [...prev, { ...EMPTY_STEP }])
  }

  function removeStep(index: number) {
    setSteps((prev) =>
      prev.length === 1 ? [{ ...EMPTY_STEP }] : prev.filter((_, i) => i !== index)
    )
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  // ── HRCW items helpers ─────────────────────────────────────────────────────

  function setHrcwItem(index: number, patch: Partial<SwmsHrcwItem>) {
    setHrcwItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    )
  }

  function addHrcwItem() {
    setHrcwItems((prev) => [
      ...prev,
      { id: newHrcwItemId(), label: '', suggested: 'no' },
    ])
  }

  function addStandardHrcwItems() {
    setHrcwItems((prev) => {
      const existing = new Set(prev.map((i) => i.id))
      return [
        ...prev,
        ...DEFAULT_HRCW_ITEMS.filter((i) => !existing.has(i.id)).map((i) => ({
          ...i,
        })),
      ]
    })
  }

  function removeHrcwItem(index: number) {
    setHrcwItems((prev) => prev.filter((_, i) => i !== index))
  }

  // ── Emergency scenario helpers ─────────────────────────────────────────────

  function setScenario(index: number, patch: Partial<SwmsEmergencyScenario>) {
    setScenarios((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertSwmsTemplate({
        id: template?.id,
        title,
        doc_control: docControl,
        hrcw_items: hrcwItems,
        requirements,
        steps,
        stop_work_triggers: stopWorkText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        emergency_scenarios: scenarios,
        references_list: referencesText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {template ? `Edit SWMS template (v${template.version})` : 'New SWMS template'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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

            {/* Document control */}
            <SectionHeading
              title="Document control"
              hint="Who prepared and approved this SWMS, and what work it covers."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="st-prepared">Prepared by</Label>
                <Input
                  id="st-prepared"
                  value={docControl.prepared_by}
                  onChange={(e) =>
                    setDocControl((d) => ({ ...d, prepared_by: e.target.value }))
                  }
                  placeholder="Director — Compliance and Technical"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="st-approved">Approved by</Label>
                <Input
                  id="st-approved"
                  value={docControl.approved_by}
                  onChange={(e) =>
                    setDocControl((d) => ({ ...d, approved_by: e.target.value }))
                  }
                  placeholder="Director — Site Delivery"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-scope">Scope of work</Label>
              <Textarea
                id="st-scope"
                value={docControl.scope_note}
                onChange={(e) =>
                  setDocControl((d) => ({ ...d, scope_note: e.target.value }))
                }
                placeholder="What work this SWMS covers, and what it does not."
                rows={3}
              />
            </div>

            {/* HRCW checklist items */}
            <SectionHeading
              title="High-risk construction work checklist"
              hint="Items confirmed yes / no / N/A when the SWMS is issued. Suggested answers pre-fill the issue form."
            />
            <div className="flex flex-col gap-2">
              {hrcwItems.map((item, i) => (
                <div key={item.id} className="flex items-start gap-2">
                  <Input
                    value={item.label}
                    onChange={(e) => setHrcwItem(i, { label: e.target.value })}
                    placeholder="Work where a person could fall more than 2 m."
                    required
                    className="flex-1"
                  />
                  <Select
                    value={item.suggested}
                    onValueChange={(v) =>
                      setHrcwItem(i, { suggested: v as HrcwAnswer })
                    }
                  >
                    <SelectTrigger
                      className="w-28 shrink-0"
                      aria-label="Suggested answer"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HRCW_ANSWERS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {HRCW_ANSWER_LABELS[a]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeHrcwItem(i)}
                  >
                    <XIcon />
                    <span className="sr-only">Remove item</span>
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addHrcwItem}>
                  <PlusIcon />
                  Add item
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addStandardHrcwItems}
                >
                  <ListChecksIcon />
                  Add standard items
                </Button>
              </div>
            </div>

            {/* Minimum requirements */}
            <SectionHeading
              title="Minimum competency, PPE, equipment & monitoring"
              hint="What must be in place before work starts."
            />
            <div className="flex flex-col gap-3">
              {(
                [
                  ['competency', 'Competency & supervision'],
                  ['licences_permits', 'Licences & permits'],
                  ['ppe', 'PPE'],
                  ['equipment', 'Equipment'],
                  ['monitoring', 'Monitoring'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`st-req-${key}`}>{label}</Label>
                  <Textarea
                    id={`st-req-${key}`}
                    value={requirements[key]}
                    onChange={(e) =>
                      setRequirements((r) => ({ ...r, [key]: e.target.value }))
                    }
                    rows={2}
                  />
                </div>
              ))}
            </div>

            {/* Work steps */}
            <SectionHeading
              title="Work steps, hazards & controls"
              hint="Each step carries an initial and residual H/M/L risk and a responsible position."
            />
            <div className="flex flex-col gap-3">
              {steps.map((s, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Step {i + 1}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => moveStep(i, -1)}
                        disabled={i === 0}
                      >
                        <ArrowUpIcon />
                        <span className="sr-only">Move up</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => moveStep(i, 1)}
                        disabled={i === steps.length - 1}
                      >
                        <ArrowDownIcon />
                        <span className="sr-only">Move down</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeStep(i)}
                      >
                        <XIcon />
                        <span className="sr-only">Remove step</span>
                      </Button>
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={s.step}
                      onChange={(e) => setStep(i, { step: e.target.value })}
                      placeholder="Work step"
                      required
                    />
                    <Input
                      value={s.hazards}
                      onChange={(e) => setStep(i, { hazards: e.target.value })}
                      placeholder="Key hazards"
                      required
                    />
                  </div>
                  <Textarea
                    value={s.controls}
                    onChange={(e) => setStep(i, { controls: e.target.value })}
                    placeholder="Required controls"
                    rows={2}
                    required
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_minmax(0,2fr)]">
                    <RiskSelect
                      value={s.initial_risk}
                      onChange={(initial_risk) => setStep(i, { initial_risk })}
                      label="Initial"
                    />
                    <RiskSelect
                      value={s.residual_risk}
                      onChange={(residual_risk) => setStep(i, { residual_risk })}
                      label="Residual"
                    />
                    <Input
                      value={s.responsible}
                      onChange={(e) => setStep(i, { responsible: e.target.value })}
                      placeholder="Responsible / evidence"
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStep}
                className="self-start"
              >
                <PlusIcon />
                Add work step
              </Button>
            </div>

            {/* Stop-work triggers */}
            <SectionHeading
              title="Stop-work triggers"
              hint="One per line. Work stops immediately when any of these occur."
            />
            <Textarea
              value={stopWorkText}
              onChange={(e) => setStopWorkText(e.target.value)}
              placeholder={'Unexpected suspect asbestos material is found.\nAn unlocated service is struck.'}
              rows={4}
            />

            {/* Emergency scenarios */}
            <SectionHeading
              title="Emergency response scenarios"
              hint="Scenario, the immediate action on site, and who to notify."
            />
            <div className="flex flex-col gap-3">
              {scenarios.map((s, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={s.scenario}
                      onChange={(e) => setScenario(i, { scenario: e.target.value })}
                      placeholder="Scenario"
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setScenarios((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <XIcon />
                      <span className="sr-only">Remove scenario</span>
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Textarea
                      value={s.immediate_action}
                      onChange={(e) =>
                        setScenario(i, { immediate_action: e.target.value })
                      }
                      placeholder="Immediate action"
                      rows={2}
                      required
                    />
                    <Textarea
                      value={s.notification}
                      onChange={(e) =>
                        setScenario(i, { notification: e.target.value })
                      }
                      placeholder="Notification / follow-up"
                      rows={2}
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setScenarios((prev) => [...prev, { ...EMPTY_SCENARIO }])}
                className="self-start"
              >
                <PlusIcon />
                Add scenario
              </Button>
            </div>

            {/* References */}
            <SectionHeading
              title="References"
              hint="One per line — legislation, codes of practice, internal procedures."
            />
            <Textarea
              value={referencesText}
              onChange={(e) => setReferencesText(e.target.value)}
              placeholder="Safe Work Australia Code of Practice: Excavation work."
              rows={3}
            />

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
