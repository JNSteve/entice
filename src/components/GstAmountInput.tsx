'use client'

import { useState } from 'react'
import { MoneyInput } from '@/components/MoneyInput'
import { aud } from '@/lib/format'
import { exGstFrom, withGst } from '@/lib/pnl'
import { cn } from '@/lib/utils'

export type GstMode = 'inc' | 'ex'

interface GstAmountInputProps {
  /** Always the EX-GST amount — what gets stored. */
  value: number | null
  onChange: (exGst: number | null) => void
  gstRate: number
  /** Which basis the typed figure starts in (receipts are inc GST). */
  defaultMode?: GstMode
  allowNegative?: boolean
}

function signedAud(n: number): string {
  return n < 0 ? `−${aud(Math.abs(n))}` : aud(n)
}

/**
 * Money input with an Inc GST / Ex GST switch. The user types the figure as it
 * appears on the receipt; the component reports the ex-GST amount.
 */
export function GstAmountInput({
  value,
  onChange,
  gstRate,
  defaultMode = 'inc',
  allowNegative,
}: GstAmountInputProps) {
  const [mode, setMode] = useState<GstMode>(defaultMode)
  // What the user typed, in the selected basis.
  const [typed, setTyped] = useState<number | null>(
    value == null ? null : defaultMode === 'inc' ? withGst(value, gstRate) : value
  )

  function emit(next: number | null, nextMode: GstMode) {
    onChange(next == null ? null : nextMode === 'inc' ? exGstFrom(next, gstRate) : next)
  }

  function switchMode(next: GstMode) {
    if (next === mode) return
    setMode(next)
    emit(typed, next)
  }

  const gst = value != null && typed != null ? typed - value : null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <MoneyInput
          value={typed}
          onChange={(v) => {
            setTyped(v)
            emit(v, mode)
          }}
          allowNegative={allowNegative}
          placeholder="0.00"
          className="flex-1"
        />
        <div
          className="inline-flex shrink-0 rounded-lg border p-0.5"
          role="radiogroup"
          aria-label="Amount includes GST?"
        >
          {(['inc', 'ex'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => switchMode(m)}
              className={cn(
                'rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors',
                mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m === 'inc' ? 'Inc GST' : 'Ex GST'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {value == null
          ? mode === 'inc'
            ? 'Type the total as printed on the receipt (including GST).'
            : 'Type the amount before GST.'
          : mode === 'inc'
            ? `Saved as ${signedAud(value)} ex GST (GST ${signedAud(gst ?? 0)}).`
            : `= ${signedAud(withGst(value, gstRate))} inc GST.`}{' '}
        {mode === 'inc' && 'GST-free item? Switch to Ex GST.'}
      </p>
    </div>
  )
}
