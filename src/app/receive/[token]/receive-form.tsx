'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { todayAUClient } from '@/lib/tz-client'
import {
  BUDF_UNITS,
  BUDF_UNIT_LABELS,
  DISPOSAL_CODES,
  PHYSICAL_NATURES,
  PHYSICAL_NATURE_LABELS,
  TREATMENT_CODES,
  WASTE_CODES,
  type BudfUnit,
  type PhysicalNature,
} from '@/lib/waste/qld-codes'
import { formatLoadNumber, type WasteLinkView } from '@/lib/waste/link-payload'
import { submitReceiverPart } from './actions'

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-base appearance-none md:text-sm'

export function ReceiveForm({
  token,
  view,
}: {
  token: string
  view: WasteLinkView
}) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  const sent = view.waste
  const [form, setForm] = useState({
    submittedBy: '',
    receivedDate: todayAUClient(),
    disposalCode: '',
    // Prefilled from what was sent — the receiver confirms or corrects it.
    physicalNature: (sent.physical_nature ?? 'S') as PhysicalNature,
    wasteCode: sent.code ?? '',
    amount: '',
    unit: (sent.unit ?? 'm3') as BudfUnit,
    discrepancy: '',
  })

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const sentAmount = Number(sent.amount ?? 0)
  const gotAmount = Number(form.amount)
  // Only comparable when both are in the same unit — never convert silently.
  const sameUnit = form.unit === sent.unit
  const variance =
    sameUnit && form.amount !== '' && Number.isFinite(gotAmount) && sentAmount > 0
      ? ((gotAmount - sentAmount) / sentAmount) * 100
      : null
  const materialVariance = variance !== null && Math.abs(variance) >= 10

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.disposalCode) {
      toast.error('Pick how the waste was disposed of or treated')
      return
    }
    if (form.amount === '') {
      toast.error('Enter the amount received')
      return
    }
    if (materialVariance && !form.discrepancy.trim()) {
      toast.error('The amount differs from what was sent — add a note explaining it')
      return
    }

    startTransition(async () => {
      const result = await submitReceiverPart({
        token,
        submittedBy: form.submittedBy,
        receivedDate: form.receivedDate,
        disposalCode: form.disposalCode,
        physicalNature: form.physicalNature,
        wasteCode: form.wasteCode,
        amount: form.amount,
        unit: form.unit,
        discrepancy: form.discrepancy || null,
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
          Receipt of load {formatLoadNumber(view.load_seq)} is with Entice. You
          can close this page.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What you received
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label>Date received</Label>
          <Input
            type="date"
            value={form.receivedDate}
            onChange={(e) => field('receivedDate', e.target.value)}
            required
          />
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => field('amount', e.target.value)}
              required
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Label>Unit</Label>
            <select
              className={selectClass}
              value={form.unit}
              onChange={(e) => field('unit', e.target.value as BudfUnit)}
            >
              {BUDF_UNITS.map((u) => (
                <option key={u} value={u}>
                  {BUDF_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Sent as {sent.amount} {sent.unit}
          {variance !== null && (
            <span
              className={cn(
                'font-medium',
                materialVariance ? 'text-amber-600 dark:text-amber-400' : ''
              )}
            >
              {' · '}
              {variance > 0 ? '+' : ''}
              {variance.toFixed(1)}%
            </span>
          )}
          {!sameUnit && form.amount !== '' && (
            <span className="ml-1">· different unit, not compared</span>
          )}
        </p>

        <div className="flex flex-col gap-2">
          <Label>Physical nature</Label>
          <div className="grid grid-cols-4 gap-2">
            {PHYSICAL_NATURES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => field('physicalNature', n)}
                aria-pressed={form.physicalNature === n}
                className={cn(
                  'rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                  form.physicalNature === n
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-muted-foreground/30'
                )}
              >
                {PHYSICAL_NATURE_LABELS[n]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Waste code</Label>
          <select
            className={selectClass}
            value={form.wasteCode}
            onChange={(e) => field('wasteCode', e.target.value)}
          >
            {WASTE_CODES.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} — {w.description.slice(0, 60)}
                {w.description.length > 60 ? '…' : ''}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          How it was handled
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label>Disposal or treatment</Label>
          <select
            className={selectClass}
            value={form.disposalCode}
            onChange={(e) => field('disposalCode', e.target.value)}
            required
          >
            <option value="">—</option>
            <optgroup label="Disposal — no resource recovery">
              {DISPOSAL_CODES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} — {d.description}
                </option>
              ))}
            </optgroup>
            <optgroup label="Treatment — may lead to resource recovery">
              {TREATMENT_CODES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} — {d.description.slice(0, 60)}
                  {d.description.length > 60 ? '…' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Discrepancies
        </h2>
        <Textarea
          value={form.discrepancy}
          onChange={(e) => field('discrepancy', e.target.value)}
          placeholder="Anything different from what the generator or transporter recorded"
          rows={2}
          maxLength={225}
        />
        {materialVariance && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-amber-800 dark:text-amber-200">
              The weighbridge figure differs from what was sent by more than
              10%. Please explain the difference above.
            </span>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-1.5">
        <Label>Your name</Label>
        <Input
          value={form.submittedBy}
          onChange={(e) => field('submittedBy', e.target.value)}
          placeholder="Weighbridge operator"
          maxLength={100}
          required
        />
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Sending…' : 'Submit receipt'}
      </Button>
    </form>
  )
}
