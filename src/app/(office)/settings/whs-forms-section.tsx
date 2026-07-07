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
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import {
  FORM_TEMPLATE_KINDS,
  FORM_FIELD_TYPES,
  type FormTemplateKind,
  type FormFieldType,
  type FormField,
} from '@/lib/zod'
import { upsertFormTemplate, setFormTemplateActive } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClipboardListIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  StarIcon,
  XIcon,
} from 'lucide-react'

export interface FormTemplateRow {
  id: string
  kind: FormTemplateKind
  name: string
  description: string | null
  schema: FormField[]
  version: number
  active: boolean
  requires_signon: boolean
  submission_count: number
}

const KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  prestart_meeting: 'Pre-Start Meeting',
  take5: 'Take 5',
  toolbox: 'Toolbox',
  induction: 'Induction',
  incident: 'Incident',
  custom: 'Custom',
  audit: 'Audit',
}

const KIND_COLORS: Record<FormTemplateKind, string> = {
  prestart: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  prestart_meeting: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  take5: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300',
  toolbox: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  induction: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  incident: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  custom: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  audit: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
}

export function WhsFormsSection({ templates }: { templates: FormTemplateRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          WHS form templates for pre-starts, Take 5, toolbox talks, inductions,
          incident reports and custom forms.
        </p>
        <FormTemplateDialog />
      </div>
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (r: FormTemplateRow) => (
              <span className="font-medium">{r.name}</span>
            ),
          },
          {
            key: 'kind',
            header: 'Kind',
            render: (r: FormTemplateRow) => (
              <Badge
                variant="outline"
                className={`border font-medium ${KIND_COLORS[r.kind]}`}
              >
                {KIND_LABELS[r.kind]}
              </Badge>
            ),
          },
          {
            key: 'version',
            header: 'Version',
            render: (r: FormTemplateRow) => (
              <Badge variant="secondary" className="tabular-nums">
                v{r.version}
              </Badge>
            ),
          },
          {
            key: 'fields',
            header: 'Fields',
            render: (r: FormTemplateRow) => (
              <span className="text-muted-foreground tabular-nums">
                {r.schema.length} {r.schema.length === 1 ? 'field' : 'fields'}
              </span>
            ),
          },
          {
            key: 'signon',
            header: 'Sign-on',
            render: (r: FormTemplateRow) =>
              r.requires_signon ? (
                <ShieldCheckIcon className="size-4 text-green-600" />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            key: 'submissions',
            header: 'Submissions',
            render: (r: FormTemplateRow) => (
              <span className="text-muted-foreground tabular-nums">
                {r.submission_count}
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: FormTemplateRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: FormTemplateRow) => (
              <div className="flex items-center justify-end gap-1">
                <FormTemplateDialog template={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={r.name}
                  onToggle={(active) => setFormTemplateActive(r.id, active)}
                />
              </div>
            ),
          },
        ]}
        rows={templates}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<ClipboardListIcon className="size-8" />}
            title="No WHS form templates yet"
            description="Create a template so workers can complete pre-starts, Take 5s, and other WHS forms."
          />
        }
      />
    </div>
  )
}

// ─── Slug helper ─────────────────────────────────────────────────────────────

function toSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

// ─── Empty field factory ─────────────────────────────────────────────────────

function emptyField(): FormField {
  return { key: '', label: '', type: 'text', options: [], required: false }
}

// ─── Builder dialog ───────────────────────────────────────────────────────────

function FormTemplateDialog({ template }: { template?: FormTemplateRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Form state
  const [name, setName] = useState(template?.name ?? '')
  const [kind, setKind] = useState<FormTemplateKind>(template?.kind ?? 'custom')
  const [description, setDescription] = useState(template?.description ?? '')
  const [requiresSignon, setRequiresSignon] = useState(template?.requires_signon ?? false)
  const [fields, setFields] = useState<FormField[]>(
    template?.schema.length ? template.schema : [emptyField()]
  )

  // Track which keys were pre-existing (preserve on edit, don't regenerate)
  const [lockedKeys] = useState<Set<string>>(
    () => new Set(template?.schema.map((f) => f.key) ?? [])
  )

  function resetForm() {
    if (!template) {
      setName('')
      setKind('custom')
      setDescription('')
      setRequiresSignon(false)
      setFields([emptyField()])
    }
  }

  function updateField(index: number, patch: Partial<FormField>) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f
        const updated = { ...f, ...patch }
        // If label changed and key is not locked (new field), auto-derive key
        if ('label' in patch && !lockedKeys.has(f.key)) {
          updated.key = toSlug(patch.label ?? '')
        }
        return updated
      })
    )
  }

  function addField() {
    setFields((prev) => [...prev, emptyField()])
  }

  function removeField(index: number) {
    setFields((prev) =>
      prev.length === 1 ? [emptyField()] : prev.filter((_, i) => i !== index)
    )
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  // Check if saving will bump version
  function willBumpVersion(): boolean {
    if (!template) return false
    return (
      template.name !== name ||
      template.requires_signon !== requiresSignon ||
      JSON.stringify(template.schema) !== JSON.stringify(fields)
    )
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate unique keys
    const keys = fields.map((f) => f.key)
    const uniqueKeys = new Set(keys)
    if (keys.length !== uniqueKeys.size) {
      toast.error('Field keys must be unique')
      return
    }

    // For select fields, validate options are set
    for (const field of fields) {
      if (field.type === 'select' && field.options.length === 0) {
        toast.error(`"${field.label || field.key}" is a select field — add at least one option`)
        return
      }
    }

    startTransition(async () => {
      const result = await upsertFormTemplate({
        id: template?.id,
        name,
        kind,
        description,
        requires_signon: requiresSignon,
        schema: fields,
        active: template?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(template ? 'Form template updated' : 'Form template created')
      setOpen(false)
      resetForm()
    })
  }

  const nextVersion = template ? template.version + 1 : 1
  const bumps = willBumpVersion()

  return (
    <>
      {template ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit form template</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New template
        </Button>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {template
                ? `Edit form template (v${template.version})`
                : 'New form template'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {/* ── Metadata ── */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ft-name">Name</Label>
                <Input
                  id="ft-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Daily Pre-Start Inspection"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ft-kind">Kind</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as FormTemplateKind)}
                >
                  <SelectTrigger id="ft-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_TEMPLATE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="ft-desc">Description</Label>
                <Textarea
                  id="ft-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description shown to workers before they complete the form"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="ft-signon"
                  checked={requiresSignon}
                  onCheckedChange={(v) => setRequiresSignon(v === true)}
                />
                <Label htmlFor="ft-signon" className="cursor-pointer">
                  Requires sign-on after submission
                </Label>
              </div>
            </div>

            {/* ── Fields + Preview ── */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Field builder */}
              <div className="flex flex-col gap-3">
                <Label>Fields</Label>
                {fields.map((field, i) => (
                  <FieldRow
                    key={i}
                    index={i}
                    field={field}
                    total={fields.length}
                    keyLocked={lockedKeys.has(field.key)}
                    onChange={(patch) => updateField(i, patch)}
                    onRemove={() => removeField(i)}
                    onMoveUp={() => moveField(i, -1)}
                    onMoveDown={() => moveField(i, 1)}
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addField}
                  className="self-start"
                >
                  <PlusIcon />
                  Add field
                </Button>
              </div>

              {/* Live preview */}
              <div className="flex flex-col gap-3">
                <Label>Preview</Label>
                <div className="rounded-lg border bg-muted/30 p-4">
                  {name && (
                    <p className="mb-3 font-semibold">{name}</p>
                  )}
                  {fields.length === 0 || (fields.length === 1 && !fields[0].label) ? (
                    <p className="text-sm text-muted-foreground">
                      Add fields to see the preview.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {fields.map((field, i) =>
                        field.label ? (
                          <PreviewField key={i} field={field} />
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Version bump note */}
            {template && bumps && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Saves as v{nextVersion}; new submissions will use the new version.
              </p>
            )}

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

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({
  index,
  field,
  total,
  keyLocked,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number
  field: FormField
  total: number
  keyLocked: boolean
  onChange: (patch: Partial<FormField>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const showOptions = field.type === 'select'

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Field {index + 1}
        </span>
        <span className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMoveUp}
            disabled={index === 0}
          >
            <ArrowUpIcon />
            <span className="sr-only">Move up</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMoveDown}
            disabled={index === total - 1}
          >
            <ArrowDownIcon />
            <span className="sr-only">Move down</span>
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
            <XIcon />
            <span className="sr-only">Remove field</span>
          </Button>
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Field label"
          required
        />
        <Select
          value={field.type}
          onValueChange={(v) => onChange({ type: v as FormFieldType, options: [] })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORM_FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Key display */}
      <p className="text-xs text-muted-foreground">
        Key:{' '}
        <code className="rounded bg-muted px-1 font-mono">
          {field.key || '—'}
        </code>
        {keyLocked && (
          <span className="ml-1 text-muted-foreground/60">(stable — locked)</span>
        )}
      </p>

      {showOptions && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Options (comma-separated)</Label>
          <Input
            value={field.options.join(', ')}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split(',')
                  .map((o) => o.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Option A, Option B, Option C"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id={`ft-req-${index}`}
          checked={field.required}
          onCheckedChange={(v) => onChange({ required: v === true })}
        />
        <Label htmlFor={`ft-req-${index}`} className="cursor-pointer text-sm">
          Required
        </Label>
      </div>
    </div>
  )
}

// ─── Live preview field ────────────────────────────────────────────────────────

function PreviewField({ field }: { field: FormField }) {
  const required = field.required

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {field.label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      <PreviewInput field={field} />
    </div>
  )
}

function PreviewInput({ field }: { field: FormField }) {
  switch (field.type) {
    case 'text':
    case 'number':
    case 'date':
    case 'time':
      return (
        <input
          disabled
          type={field.type}
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm opacity-60"
          placeholder={field.label}
        />
      )
    case 'textarea':
      return (
        <textarea
          disabled
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm opacity-60"
          placeholder={field.label}
        />
      )
    case 'select':
      return (
        <select
          disabled
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm opacity-60"
        >
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    case 'checkbox':
      return (
        <div className="flex items-center gap-2 opacity-60">
          <input type="checkbox" disabled className="size-4 rounded border border-input" />
          <span className="text-sm text-muted-foreground">Check to confirm</span>
        </div>
      )
    case 'rating':
      return (
        <div className="flex items-center gap-1 opacity-60">
          {Array.from({ length: 5 }, (_, i) => (
            <StarIcon key={i} className="size-5 text-muted-foreground" />
          ))}
        </div>
      )
    case 'signature':
      return (
        <div className="flex h-20 w-full items-center justify-center rounded-md border border-dashed border-input bg-background opacity-60">
          <span className="text-sm text-muted-foreground">Signature area</span>
        </div>
      )
    case 'photo':
      return (
        <div className="flex h-20 w-full items-center justify-center rounded-md border border-dashed border-input bg-background opacity-60">
          <span className="text-sm text-muted-foreground">Photo upload</span>
        </div>
      )
    default:
      return null
  }
}
