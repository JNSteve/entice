'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2Icon, ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { todayAUClient } from '@/lib/tz-client'
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABELS,
  type VehicleType,
} from '@/lib/waste/qld-codes'
import { formatLoadNumber, type WasteLinkView } from '@/lib/waste/link-payload'
import { submitTransporterPart } from './actions'

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-sm appearance-none'

/** Fields the driver may correct about their own company. */
const CONFIRMABLE = [
  { key: 'ea_number', label: 'Environmental authority number' },
  { key: 'contact_name', label: 'Contact name' },
  { key: 'contact_number', label: 'Contact number' },
  { key: 'street_number', label: 'Depot street number' },
  { key: 'street_name', label: 'Depot street name' },
  { key: 'suburb', label: 'Depot suburb' },
  { key: 'postcode', label: 'Depot postcode' },
] as const

export function HaulForm({ token, view }: { token: string; view: WasteLinkView }) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const held = view.transporter
  const [form, setForm] = useState({
    submittedBy: '',
    collectionDate: view.generator.collection_date ?? todayAUClient(),
    vehicle1Plate: '',
    vehicle1Type: 'V' as VehicleType,
    vehicle2Plate: '',
    vehicle2Type: '' as VehicleType | '',
    discrepancy: '',
  })
  const [declared, setDeclared] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CONFIRMABLE.map((f) => [f.key, (held[f.key] as string | null) ?? ''])
    )
  )

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Only genuinely changed values travel as a variance, so the office
    // reviews real corrections rather than every submission.
    const variance: Record<string, string> = {}
    for (const f of CONFIRMABLE) {
      const original = ((held[f.key] as string | null) ?? '').trim()
      const now = (declared[f.key] ?? '').trim()
      if (now !== original) variance[f.key] = now
    }

    startTransition(async () => {
      const result = await submitTransporterPart({
        token,
        submittedBy: form.submittedBy,
        collectionDate: form.collectionDate,
        vehicle1Plate: form.vehicle1Plate,
        vehicle1Type: form.vehicle1Type,
        vehicle2Plate: form.vehicle2Plate || null,
        vehicle2Type: form.vehicle2Plate ? form.vehicle2Type || null : null,
        discrepancy: form.discrepancy || null,
        declaredVariance: variance,
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      setDone(true)
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-6 py-10 text-center">
        <CheckCircle2Icon className="size-10 text-green-600 dark:text-green-400" />
        <h2 className="text-lg font-bold">Thanks — recorded</h2>
        <p className="text-sm text-muted-foreground">
          Transport details for load {formatLoadNumber(view.load_seq)} are with
          Entice. You can close this page.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your vehicles
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label>Collection date</Label>
          <Input
            type="date"
            value={form.collectionDate}
            onChange={(e) => field('collectionDate', e.target.value)}
            required
          />
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Vehicle 1 number plate</Label>
            <Input
              value={form.vehicle1Plate}
              onChange={(e) => field('vehicle1Plate', e.target.value.toUpperCase())}
              maxLength={7}
              autoCapitalize="characters"
              required
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Label>Type</Label>
            <select
              className={selectClass}
              value={form.vehicle1Type}
              onChange={(e) => field('vehicle1Type', e.target.value as VehicleType)}
            >
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Vehicle 2 / trailer (if any)</Label>
            <Input
              value={form.vehicle2Plate}
              onChange={(e) => field('vehicle2Plate', e.target.value.toUpperCase())}
              maxLength={7}
              autoCapitalize="characters"
              placeholder="Leave blank if none"
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Label>Type</Label>
            <select
              className={selectClass}
              value={form.vehicle2Type}
              onChange={(e) => field('vehicle2Type', e.target.value as VehicleType | '')}
              disabled={!form.vehicle2Plate}
            >
              <option value="">—</option>
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <button
          type="button"
          onClick={() => setShowDetails((s) => !s)}
          className="flex items-center justify-between gap-2 text-left"
        >
          <span className="flex flex-col">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your details
            </span>
            <span className="text-xs text-muted-foreground">
              {held.name} · EA {held.ea_number || '—'}
            </span>
          </span>
          <ChevronDownIcon
            className={cn('size-4 shrink-0 transition-transform', showDetails && 'rotate-180')}
          />
        </button>

        {showDetails && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Correct anything that is out of date. Changes are passed to Entice
              for review — they do not update your record directly.
            </p>
            {CONFIRMABLE.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label>{f.label}</Label>
                <Input
                  value={declared[f.key] ?? ''}
                  onChange={(e) =>
                    setDeclared((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Anything wrong with the load?
        </h2>
        <Textarea
          value={form.discrepancy}
          onChange={(e) => field('discrepancy', e.target.value)}
          placeholder="Note any discrepancy with what the generator recorded (optional)"
          rows={2}
          maxLength={225}
        />
      </section>

      <div className="flex flex-col gap-1.5">
        <Label>Your name</Label>
        <Input
          value={form.submittedBy}
          onChange={(e) => field('submittedBy', e.target.value)}
          placeholder="Driver name"
          maxLength={100}
          required
        />
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Sending…' : 'Submit transport details'}
      </Button>
    </form>
  )
}
