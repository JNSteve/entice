'use client'

import React, { useState, useEffect } from 'react'
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
  const [rawText, setRawText] = useState('')

  // When value changes externally and not focused, sync display
  useEffect(() => {
    if (!focused) {
      setRawText(formatDisplay(value))
    }
  }, [value, focused])

  function handleFocus() {
    setFocused(true)
    // Show raw number without formatting when focused
    setRawText(value != null ? String(value) : '')
  }

  function handleBlur() {
    setFocused(false)
    const parsed = parseRaw(rawText, allowNegative)
    onChange(parsed)
    setRawText(formatDisplay(parsed))
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRawText(e.target.value)
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={rawText}
      placeholder={placeholder ?? '0.00'}
      className={cn('text-right tabular-nums', className)}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}
