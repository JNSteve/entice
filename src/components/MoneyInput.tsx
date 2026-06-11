'use client'

import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface MoneyInputProps {
  value: number | null
  onChange: (v: number | null) => void
  allowNegative?: boolean
  placeholder?: string
  className?: string
}

function formatDisplay(value: number | null): string {
  if (value == null) return ''
  return value.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function parseRaw(raw: string, allowNegative: boolean): number | null {
  // Strip $, commas, spaces and any whitespace
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const n = parseFloat(cleaned)
  if (isNaN(n)) return null
  if (!allowNegative && n < 0) return null
  return n
}

export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  placeholder,
  className,
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false)
  // rawText is only meaningful while focused; when blurred we derive from value.
  const [rawText, setRawText] = useState('')

  function handleFocus() {
    setFocused(true)
    // Show raw number without formatting when focused.
    setRawText(value != null ? String(value) : '')
  }

  function handleBlur() {
    setFocused(false)
    const parsed = parseRaw(rawText, allowNegative)
    onChange(parsed)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRawText(e.target.value)
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={focused ? rawText : formatDisplay(value)}
      placeholder={placeholder ?? '0.00'}
      className={cn('text-right tabular-nums', className)}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}
