'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CameraIcon, CheckIcon, StarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SignaturePad } from '@/components/SignaturePad'
import { nowAUInput } from '@/lib/tz-client'
import { cn } from '@/lib/utils'
import {
  validateSubmissionData,
  MAX_SIGNATURE_CHARS,
} from '@/lib/form-validate'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  type FormField,
  type FormTemplateKind,
  type IncidentType,
} from '@/lib/zod'
import { submitForm, createIncident } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TargetOption = { id: string; label: string }

interface FormRendererProps {
  template: {
    id: string
    kind: FormTemplateKind
    schema: FormField[]
    requires_signon: boolean
  }
  projects: TargetOption[]
  jobs: TargetOption[]
  plantItems: TargetOption[]
  defaultProjectId: string | null
  defaultJobId: string | null
  /** Prefill for incident-kind templates (e.g. environmental exceedance link). */
  defaultIncidentType?: IncidentType | null
  /** Amend mode: id of the submission this one supersedes. */
  amendsId?: string | null
  /** Amend mode: the original submission's answers, used as initial state. */
  initialValues?: Record<string, unknown> | null
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-sm appearance-none'

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

function RequiredMark({ required }: { required: boolean }) {
  if (!required) return null
  return <span className="text-destructive"> *</span>
}

/** Large touch row for checkbox answers (Take 5 steps etc.). */
function CheckboxRow({
  label,
  required,
  checked,
  error,
  onToggle,
}: {
  label: string
  required: boolean
  checked: boolean
  error?: string
  onToggle: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors active:bg-muted',
          checked && 'border-foreground/40 bg-muted/40',
          error && 'border-destructive'
        )}
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border-2',
            checked
              ? 'border-foreground bg-foreground text-background'
              : 'border-muted-foreground/40'
          )}
        >
          {checked && <CheckIcon className="size-4" />}
        </span>
        <span className="text-sm font-medium">
          {label}
          <RequiredMark required={required} />
        </span>
      </button>
      <FieldError message={error} />
    </div>
  )
}

/** 5-star touch rating. */
function RatingRow({
  value,
  onChange,
}: {
  value: number | null
  onChange: (n: number) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="p-1.5"
          aria-label={`${n} of 5`}
        >
          <StarIcon
            className={cn(
              'size-8',
              value !== null && n <= value
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground/40'
            )}
          />
        </button>
      ))}
    </div>
  )
}

// ─── Target picker ───────────────────────────────────────────────────────────

function TargetSection({
  projects,
  jobs,
  plantItems,
  showPlant,
  projectId,
  jobId,
  plantId,
  onProject,
  onJob,
  onPlant,
  errors,
}: {
  projects: TargetOption[]
  jobs: TargetOption[]
  plantItems: TargetOption[]
  showPlant: boolean
  projectId: string
  jobId: string
  plantId: string
  onProject: (id: string) => void
  onJob: (id: string) => void
  onPlant: (id: string) => void
  errors: Record<string, string>
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Where are you working?
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="target-project">Project</Label>
        <select
          id="target-project"
          className={cn(selectClass, errors.target && 'border-destructive')}
          value={projectId}
          onChange={(e) => onProject(e.target.value)}
        >
          <option value="">—</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              P-{p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="target-job">or Job</Label>
        <select
          id="target-job"
          className={cn(selectClass, errors.target && 'border-destructive')}
          value={jobId}
          onChange={(e) => onJob(e.target.value)}
        >
          <option value="">—</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              J-{j.label}
            </option>
          ))}
        </select>
      </div>
      <FieldError message={errors.target} />

      {showPlant && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target-plant">
            Plant / equipment<span className="text-destructive"> *</span>
          </Label>
          <select
            id="target-plant"
            className={cn(selectClass, errors.plant && 'border-destructive')}
            value={plantId}
            onChange={(e) => onPlant(e.target.value)}
          >
            <option value="">—</option>
            {plantItems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.plant} />
        </div>
      )}
    </div>
  )
}

// ─── Dynamic schema field ────────────────────────────────────────────────────

function SchemaField({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField
  value: unknown
  error?: string
  onChange: (v: unknown) => void
}) {
  const id = `f-${field.key}`

  if (field.type === 'checkbox') {
    return (
      <CheckboxRow
        label={field.label}
        required={field.required}
        checked={value === true}
        error={error}
        onToggle={() => onChange(value === true ? false : true)}
      />
    )
  }

  if (field.type === 'photo') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed px-4 py-3">
        <CameraIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="font-medium">{field.label}</span>
          <span className="text-muted-foreground">
            Photos are added after submit, on the summary screen.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        <RequiredMark required={field.required} />
      </Label>

      {field.type === 'text' && (
        <Input
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-destructive')}
        />
      )}

      {field.type === 'textarea' && (
        <Textarea
          id={id}
          rows={3}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-destructive')}
        />
      )}

      {field.type === 'number' && (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-destructive')}
        />
      )}

      {field.type === 'select' && (
        <select
          id={id}
          className={cn(selectClass, error && 'border-destructive')}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      {field.type === 'date' && (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn('w-44', error && 'border-destructive')}
        />
      )}

      {field.type === 'time' && (
        <Input
          id={id}
          type="time"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn('w-36', error && 'border-destructive')}
        />
      )}

      {field.type === 'rating' && (
        <RatingRow
          value={typeof value === 'number' ? value : null}
          onChange={(n) => onChange(n)}
        />
      )}

      {field.type === 'signature' && (
        <SignaturePad
          onChange={(dataUrl) => {
            if (dataUrl && dataUrl.length > MAX_SIGNATURE_CHARS) {
              toast.error('Signature image is too large — clear and try again')
              onChange(null)
              return
            }
            onChange(dataUrl)
          }}
        />
      )}

      <FieldError message={error} />
    </div>
  )
}

// ─── Incident structured form ────────────────────────────────────────────────

// ─── Main renderer ───────────────────────────────────────────────────────────

export function FormRenderer({
  template,
  projects,
  jobs,
  plantItems,
  defaultProjectId,
  defaultJobId,
  defaultIncidentType,
  amendsId,
  initialValues,
}: FormRendererProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [jobId, setJobId] = useState(defaultJobId ?? '')
  const [plantId, setPlantId] = useState('')

  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Incident structured state
  const [incidentType, setIncidentType] = useState<IncidentType | ''>(
    defaultIncidentType ?? ''
  )
  const [severity, setSeverity] = useState<number | null>(null)
  const [occurredAt, setOccurredAt] = useState(nowAUInput())
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [immediateAction, setImmediateAction] = useState('')

  const isIncident = template.kind === 'incident'
  const isPrestart = template.kind === 'prestart'

  function setValue(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }))
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function validateTarget(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!projectId && !jobId) errs.target = 'Pick a project or job'
    if (isPrestart && !plantId) errs.plant = 'Pick the plant item being inspected'
    return errs
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const targetErrs = validateTarget()

    if (isIncident) {
      const incidentErrs: Record<string, string> = { ...targetErrs }
      if (!incidentType) incidentErrs.type = 'Pick the incident type'
      if (severity === null) incidentErrs.severity = 'Rate the severity'
      if (!occurredAt) incidentErrs.occurred_at = 'When did it happen?'
      if (!description.trim()) incidentErrs.description = 'Describe what happened'
      if (Object.keys(incidentErrs).length > 0) {
        setErrors(incidentErrs)
        toast.error(Object.values(incidentErrs)[0])
        return
      }
      setErrors({})
      startTransition(async () => {
        const result = await createIncident({
          project_id: projectId || null,
          job_id: jobId || null,
          type: incidentType,
          severity,
          occurred_at: occurredAt,
          location: location.trim() || null,
          description: description.trim(),
          immediate_action: immediateAction.trim() || null,
        })
        if (result.error || !result.id) {
          toast.error(result.error ?? 'Could not save the incident')
          return
        }
        toast.success('Incident reported')
        router.push(`/field/safety/incident/${result.id}`)
      })
      return
    }

    const validated = validateSubmissionData(template.schema, values)
    const allErrs: Record<string, string> = {
      ...targetErrs,
      ...(validated.ok ? {} : validated.errors),
    }
    if (Object.keys(allErrs).length > 0) {
      setErrors(allErrs)
      toast.error(Object.values(allErrs)[0])
      return
    }
    setErrors({})

    startTransition(async () => {
      const result = await submitForm({
        template_id: template.id,
        project_id: projectId || null,
        job_id: jobId || null,
        plant_id: isPrestart ? plantId || null : null,
        data: validated.ok ? validated.data : {},
        amends: amendsId ?? null,
      })
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Could not save the form')
        return
      }
      toast.success(
        template.requires_signon ? 'Submitted — collect sign-ons next' : 'Submitted'
      )
      router.push(`/field/safety/submission/${result.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {amendsId && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-950">
          Amending an earlier submission — this creates a new record and keeps
          the original for the audit trail.
        </div>
      )}
      <TargetSection
        projects={projects}
        jobs={jobs}
        plantItems={plantItems}
        showPlant={isPrestart}
        projectId={projectId}
        jobId={jobId}
        plantId={plantId}
        onProject={(id) => {
          setProjectId(id)
          if (id) setJobId('')
          setErrors((prev) => {
            const next = { ...prev }
            delete next.target
            return next
          })
        }}
        onJob={(id) => {
          setJobId(id)
          if (id) setProjectId('')
          setErrors((prev) => {
            const next = { ...prev }
            delete next.target
            return next
          })
        }}
        onPlant={(id) => {
          setPlantId(id)
          setErrors((prev) => {
            const next = { ...prev }
            delete next.plant
            return next
          })
        }}
        errors={errors}
      />

      {isIncident ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inc-type">
              Incident type<span className="text-destructive"> *</span>
            </Label>
            <select
              id="inc-type"
              className={cn(selectClass, errors.type && 'border-destructive')}
              value={incidentType}
              onChange={(e) => {
                setIncidentType(e.target.value as IncidentType | '')
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.type
                  return next
                })
              }}
            >
              <option value="">—</option>
              {INCIDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INCIDENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <FieldError message={errors.type} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Severity (1 low — 5 critical)
              <span className="text-destructive"> *</span>
            </Label>
            <RatingRow
              value={severity}
              onChange={(n) => {
                setSeverity(n)
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.severity
                  return next
                })
              }}
            />
            <FieldError message={errors.severity} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inc-occurred">
              When it happened<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="inc-occurred"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className={cn('w-56', errors.occurred_at && 'border-destructive')}
            />
            <FieldError message={errors.occurred_at} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inc-location">Location</Label>
            <Input
              id="inc-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Level 2 slab, NE corner"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inc-description">
              What happened<span className="text-destructive"> *</span>
            </Label>
            <Textarea
              id="inc-description"
              rows={4}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.description
                  return next
                })
              }}
              className={cn(errors.description && 'border-destructive')}
            />
            <FieldError message={errors.description} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inc-action">Immediate action taken</Label>
            <Textarea
              id="inc-action"
              rows={3}
              value={immediateAction}
              onChange={(e) => setImmediateAction(e.target.value)}
            />
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
            <CameraIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              Photos are added after submit, on the incident summary screen.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {template.schema.map((field) => (
            <SchemaField
              key={field.key}
              field={field}
              value={values[field.key]}
              error={errors[field.key]}
              onChange={(v) => setValue(field.key, v)}
            />
          ))}
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Submitting…' : isIncident ? 'Report incident' : 'Submit'}
      </Button>
    </form>
  )
}
