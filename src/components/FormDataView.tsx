import React from 'react'
import type { FormField } from '@/lib/zod'

interface FormDataViewProps {
  schema: FormField[]
  data: Record<string, unknown>
}

function FieldValue({ field, value }: { field: FormField; value: unknown }) {
  switch (field.type) {
    case 'checkbox':
      return (
        <span className="font-medium">{value ? '✓ Yes' : '✗ No'}</span>
      )
    case 'rating': {
      const n = Number(value) || 0
      return (
        <span className="font-medium">
          {'★'.repeat(Math.min(n, 5))}{'☆'.repeat(Math.max(0, 5 - n))} ({n}/5)
        </span>
      )
    }
    case 'photo':
      return (
        <span className="text-muted-foreground italic">
          {value ? `Photo attached` : 'No photo'}
        </span>
      )
    case 'signature':
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        return (
          <img
            src={value}
            alt="Signature"
            className="max-h-16 max-w-48 rounded border bg-white"
          />
        )
      }
      return <span className="text-muted-foreground italic">{value ? 'Signed' : 'Not signed'}</span>
    default: {
      const text = value != null && value !== '' ? String(value) : null
      if (!text) return <span className="text-muted-foreground">—</span>
      return <span>{text}</span>
    }
  }
}

/**
 * Read-only renderer for a form submission's data, driven by the template schema.
 * Used by both the field submission read-only page and the office forms register drawer.
 */
export function FormDataView({ schema, data }: FormDataViewProps) {
  // Keys present in data but not in current schema (schema drift)
  const schemaKeys = new Set(schema.map((f) => f.key))
  const extraKeys = Object.keys(data).filter((k) => !schemaKeys.has(k))

  return (
    <div className="flex flex-col gap-4">
      {schema.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {field.label}
          </p>
          <div className="text-sm">
            <FieldValue field={field} value={data[field.key]} />
          </div>
        </div>
      ))}

      {extraKeys.length > 0 && (
        <div className="mt-2 rounded-md border border-dashed p-3 flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Other recorded fields
          </p>
          {extraKeys.map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{key}</p>
              <p className="text-sm">
                {data[key] != null && data[key] !== '' ? String(data[key]) : '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
