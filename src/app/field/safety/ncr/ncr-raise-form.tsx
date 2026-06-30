'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhotoUpload } from '@/components/PhotoUpload'
import { cn } from '@/lib/utils'
import { raiseFieldNcr } from './actions'

export type TargetOption = { id: string; label: string }

const FIELD_SOURCES = [
  { value: 'quality', label: 'Quality' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' },
] as const

type FieldSource = (typeof FIELD_SOURCES)[number]['value']

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-sm appearance-none'

interface NcrRaiseFormProps {
  projects: TargetOption[]
  defaultProjectId: string | null
}

export function NcrRaiseForm({ projects, defaultProjectId }: NcrRaiseFormProps) {
  const [pending, startTransition] = useTransition()
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [form, setForm] = useState({
    source: 'quality' as FieldSource,
    title: '',
    description: '',
    project_id: defaultProjectId ?? '',
  })

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error('Add a short title')
      return
    }
    if (!form.description.trim()) {
      toast.error('Describe the problem')
      return
    }
    startTransition(async () => {
      const result = await raiseFieldNcr({
        source: form.source,
        title: form.title,
        description: form.description,
        project_id: form.project_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Problem reported')
      setCreatedId(result.id ?? null)
    })
  }

  // ── Success screen: photo upload + done ──────────────────────────────────
  if (createdId) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
          <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <span>
            Reported. The office will review and assign corrective actions.
          </span>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Add photos (optional)
          </h2>
          <PhotoUpload
            parentType="ncr"
            parentId={createdId}
            kind="photo"
            capture
            multiple
          />
        </section>

        <Button render={<Link href="/field/safety" />} size="lg" variant="outline">
          Done
        </Button>
      </div>
    )
  }

  // ── Report form ──────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label>What kind of problem?</Label>
        <div className="grid grid-cols-2 gap-2">
          {FIELD_SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => field('source', s.value)}
              aria-pressed={form.source === s.value}
              className={cn(
                'rounded-xl border px-4 py-3 text-sm font-medium transition-colors active:bg-muted',
                form.source === s.value
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-muted-foreground/30'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Title</Label>
        <Input
          value={form.title}
          onChange={(e) => field('title', e.target.value)}
          placeholder="Short summary"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>What&apos;s wrong?</Label>
        <Textarea
          value={form.description}
          onChange={(e) => field('description', e.target.value)}
          placeholder="Describe the problem and where it is"
          rows={4}
          required
        />
      </div>

      {projects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Project (optional)</Label>
          <select
            className={selectClass}
            value={form.project_id}
            onChange={(e) => field('project_id', e.target.value)}
          >
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Reporting…' : 'Report problem'}
      </Button>
    </form>
  )
}
