'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhotoUpload } from '@/components/PhotoUpload'
import { cn } from '@/lib/utils'
import { todayAUClient } from '@/lib/tz-client'
import { gatingWarnings, type WasteUnit } from '@/lib/env'
import {
  WASTE_CLASSIFICATIONS,
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNITS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import { createWasteLoad } from '@/app/(office)/whs/env/actions'

export type TargetOption = { id: string; label: string }

export interface FieldFacilityOption {
  id: string
  name: string
  licence_expiry: string | null
  active: boolean
}

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-base appearance-none md:text-sm'

export function FieldWasteForm({
  projects,
  jobs,
  facilities,
  defaultProjectId,
}: {
  projects: TargetOption[]
  jobs: TargetOption[]
  facilities: FieldFacilityOption[]
  defaultProjectId: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [created, setCreated] = useState<{ id: string; number: string } | null>(
    null
  )
  const [form, setForm] = useState({
    project_id: defaultProjectId ?? '',
    job_id: '',
    classification: 'general' as WasteClassification,
    classification_detail: '',
    qty: '',
    unit: 't' as WasteUnitKey,
    facility_id: '',
    docket_ref: '',
    transporter: '',
    override_reason: '',
  })

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const selectedFacility =
    facilities.find((f) => f.id === form.facility_id) ?? null

  // Facility gating: WARN + override reason — never a block at the gate.
  // Cheap pure computation — recomputed per render (React Compiler memoises).
  const warnings = gatingWarnings({
    facility: selectedFacility
      ? {
          name: selectedFacility.name,
          licence_expiry: selectedFacility.licence_expiry,
          active: selectedFacility.active,
        }
      : null,
    permit: null,
    permitLoadsSoFar: [],
    load: {
      classification: form.classification,
      qty: Number(form.qty) || 0,
      unit: form.unit as WasteUnit,
    },
    today: todayAUClient(),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.project_id && !form.job_id) {
      toast.error('Pick a project or job')
      return
    }
    if (!form.qty || Number(form.qty) <= 0) {
      toast.error('Enter the load quantity')
      return
    }
    if (warnings.length > 0 && !form.override_reason.trim()) {
      toast.error('Add an override reason to proceed despite the warning')
      return
    }
    startTransition(async () => {
      const result = await createWasteLoad({
        project_id: form.project_id || null,
        job_id: form.project_id ? null : form.job_id || null,
        date: todayAUClient(),
        classification: form.classification,
        classification_detail: form.classification_detail || null,
        qty: form.qty,
        unit: form.unit,
        facility_id: form.facility_id || null,
        permit_id: null,
        transporter: form.transporter || null,
        vendor_id: null,
        docket_ref: form.docket_ref || null,
        notes: null,
        override_reason: warnings.length > 0 ? form.override_reason : null,
      })
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Could not log the load')
        return
      }
      toast.success(`Load ${result.number ?? ''} logged`)
      setCreated({ id: result.id, number: result.number ?? '' })
    })
  }

  // ── Success screen: docket photo + done ──────────────────────────────────
  if (created) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
          <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <span>
            Load {created.number} logged. Photograph the docket before the truck
            leaves.
          </span>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Docket photo
          </h2>
          <PhotoUpload
            parentType="waste_load"
            parentId={created.id}
            kind="docket"
            capture
            multiple
          />
        </section>

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              setCreated(null)
              setForm((f) => ({
                ...f,
                qty: '',
                docket_ref: '',
                classification_detail: '',
                override_reason: '',
              }))
            }}
          >
            Log another load
          </Button>
          <Button render={<Link href="/field" />} size="lg" variant="ghost">
            Done
          </Button>
        </div>
      </div>
    )
  }

  // ── Quick-log form ───────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {projects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Project</Label>
          <select
            className={selectClass}
            value={form.project_id}
            onChange={(e) => {
              field('project_id', e.target.value)
              if (e.target.value) field('job_id', '')
            }}
          >
            <option value="">—</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>or Job</Label>
          <select
            className={selectClass}
            value={form.job_id}
            onChange={(e) => {
              field('job_id', e.target.value)
              if (e.target.value) field('project_id', '')
            }}
          >
            <option value="">—</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>What&apos;s on the truck?</Label>
        <div className="grid grid-cols-2 gap-2">
          {WASTE_CLASSIFICATIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => field('classification', c)}
              aria-pressed={form.classification === c}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm font-medium transition-colors active:bg-muted',
                form.classification === c
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-muted-foreground/30'
              )}
            >
              {WASTE_CLASSIFICATION_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Detail (optional)</Label>
        <Input
          value={form.classification_detail}
          onChange={(e) => field('classification_detail', e.target.value)}
          placeholder="e.g. bonded sheeting, VENM"
        />
      </div>

      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Quantity</Label>
          <Input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={form.qty}
            onChange={(e) => field('qty', e.target.value)}
            required
          />
        </div>
        <div className="flex gap-1">
          {WASTE_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => field('unit', u)}
              aria-pressed={form.unit === u}
              className={cn(
                'rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
                form.unit === u
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-muted-foreground/30'
              )}
            >
              {WASTE_UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Receiving facility</Label>
        <select
          className={selectClass}
          value={form.facility_id}
          onChange={(e) => field('facility_id', e.target.value)}
        >
          <option value="">—</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Docket number (optional)</Label>
        <Input
          value={form.docket_ref}
          onChange={(e) => field('docket_ref', e.target.value)}
          placeholder="Weighbridge / tipping docket no."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Transporter (optional)</Label>
        <Input
          value={form.transporter}
          onChange={(e) => field('transporter', e.target.value)}
          placeholder="Carrier / truck"
        />
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-col gap-1">
              {warnings.map((w) => (
                <p key={w} className="text-amber-800 dark:text-amber-200">
                  {w}
                </p>
              ))}
            </div>
          </div>
          <Textarea
            value={form.override_reason}
            onChange={(e) => field('override_reason', e.target.value)}
            placeholder="Why is this load proceeding? (required)"
            rows={2}
          />
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Logging…' : 'Log load'}
      </Button>
    </form>
  )
}
