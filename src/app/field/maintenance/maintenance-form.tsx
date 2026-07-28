'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2Icon, MapPinIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhotoUpload } from '@/components/PhotoUpload'
import { cn } from '@/lib/utils'
import { MAINTENANCE_KINDS, type MaintenanceKind } from '@/lib/zod'
import { createMaintenanceEntry } from '@/lib/maintenance'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SiteOption = {
  id: string
  name: string
  client_name: string | null
}

/** A recent job/project assignment — tapping it sets the property + links the
 * work that carried out the maintenance. */
export type MaintenanceTarget = {
  id: string
  type: 'job' | 'project'
  number: string
  label: string
  site_id: string | null
}

const KIND_LABELS: Record<MaintenanceKind, string> = {
  make_safe: 'Make-safe',
  repair: 'Repair',
  maintenance: 'Maintenance',
  inspection: 'Inspection',
}

const selectClass =
  'w-full rounded-lg border bg-background px-3 py-2.5 text-base appearance-none md:text-sm'

// ─── Form ─────────────────────────────────────────────────────────────────────

export function MaintenanceForm({
  sites,
  recentTargets,
  today,
}: {
  sites: SiteOption[]
  recentTargets: MaintenanceTarget[]
  today: string
}) {
  const [pending, startTransition] = useTransition()
  const [createdId, setCreatedId] = useState<string | null>(null)

  const [siteId, setSiteId] = useState('')
  const [target, setTarget] = useState<MaintenanceTarget | null>(null)
  const [siteQuery, setSiteQuery] = useState('')
  const [kind, setKind] = useState<MaintenanceKind>('make_safe')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [doneAt, setDoneAt] = useState(today)
  const [temporary, setTemporary] = useState(false)
  const [followUpDue, setFollowUpDue] = useState('')

  const selectedSite = sites.find((s) => s.id === siteId) ?? null

  function pickTarget(t: MaintenanceTarget) {
    // Tapping the active chip clears the link; the property stays put.
    if (target?.id === t.id) {
      setTarget(null)
      return
    }
    setTarget(t)
    if (t.site_id) setSiteId(t.site_id)
  }

  function pickSite(id: string) {
    setSiteId(id)
    // A manual property choice drops any job/project link — that work may
    // belong to a different property.
    setTarget(null)
    setSiteQuery('')
  }

  const q = siteQuery.trim().toLowerCase()
  const filteredSites = q
    ? sites.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.client_name ?? '').toLowerCase().includes(q)
      )
    : []

  function resetForm() {
    setCreatedId(null)
    setTitle('')
    setDescription('')
    setTemporary(false)
    setDoneAt(today)
    // Keep the property, work link and kind — crews often log several entries
    // against the same property in one visit.
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!siteId) {
      toast.error('Pick a property')
      return
    }
    if (!title.trim()) {
      toast.error('Add a short title')
      return
    }

    startTransition(async () => {
      const result = await createMaintenanceEntry({
        site_id: siteId,
        kind,
        title: title.trim(),
        description: description.trim() || null,
        done_at: doneAt,
        status: temporary ? 'open' : 'resolved',
        follow_up: temporary ? 'Permanent repair recommended' : null,
        follow_up_due: temporary ? followUpDue || null : null,
        job_id: target?.type === 'job' ? target.id : null,
        project_id: target?.type === 'project' ? target.id : null,
        client_visible: true,
      })
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Could not log the entry')
        return
      }
      toast.success('Maintenance entry logged')
      setCreatedId(result.id)
    })
  }

  // ── Success screen: evidence photos + log another ────────────────────────
  if (createdId) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
          <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <span>
            Entry logged{selectedSite ? ` for ${selectedSite.name}` : ''}. Add
            photos of the work while you&apos;re on site.
          </span>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Add evidence photos
          </h2>
          <PhotoUpload
            parentType="maintenance"
            parentId={createdId}
            kind="photo"
            capture
            multiple
          />
        </section>

        <div className="flex flex-col gap-2">
          <Button size="lg" variant="outline" onClick={resetForm}>
            Log another
          </Button>
          <Button render={<Link href="/field" />} size="lg" variant="ghost">
            Done
          </Button>
        </div>
      </div>
    )
  }

  // ── Entry form ───────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Property picker */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Property
        </p>

        {/* Recent assignments — tap to set the property + link the work */}
        {recentTargets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {recentTargets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTarget(t)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  target?.id === t.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-background hover:bg-muted'
                )}
              >
                <span className="font-mono text-[10px] opacity-60">
                  {t.type === 'job' ? 'J-' : 'P-'}
                  {t.number}
                </span>
                <span className="max-w-[120px] truncate">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search all properties */}
        <input
          type="search"
          placeholder="Search properties…"
          value={siteQuery}
          onChange={(e) => setSiteQuery(e.target.value)}
          className="w-full rounded-xl border bg-background px-3 py-2.5 text-base md:text-sm"
        />

        {q && (
          <div className="max-h-48 divide-y overflow-y-auto rounded-xl border">
            {filteredSites.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No properties found.
              </p>
            ) : (
              filteredSites.slice(0, 10).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSite(s.id)}
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted"
                >
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {s.client_name && (
                    <span className="truncate text-xs text-muted-foreground">
                      {s.client_name}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {/* Selected property */}
        {selectedSite && (
          <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
            <MapPinIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {selectedSite.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {target
                  ? `Linked to ${target.type === 'job' ? 'job J-' : 'project P-'}${target.number}`
                  : (selectedSite.client_name ?? '')}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSiteId('')
                setTarget(null)
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear property"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Type */}
      <div className="flex flex-col gap-1.5">
        <Label>Type</Label>
        <select
          className={selectClass}
          value={kind}
          onChange={(e) => setKind(e.target.value as MaintenanceKind)}
        >
          {MAINTENANCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label>Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Capped broken gas line"
          required
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label>Description (optional)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was found and what was done"
          rows={3}
        />
      </div>

      {/* Date done */}
      <div className="flex flex-col gap-1.5">
        <Label>Date done</Label>
        <Input
          type="date"
          className="w-44"
          value={doneAt}
          onChange={(e) => setDoneAt(e.target.value)}
        />
      </div>

      {/* Temporary make-safe */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
        <input
          type="checkbox"
          checked={temporary}
          onChange={(e) => setTemporary(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            Temporary — needs permanent fix
          </span>
          <span className="text-xs text-muted-foreground">
            Flags this as an open make-safe so the office and client can see a
            permanent repair is still required.
          </span>
        </span>
      </label>

      {temporary && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="fm-due">
            Permanent fix due by (optional)
          </label>
          <Input
            id="fm-due"
            type="date"
            value={followUpDue}
            onChange={(e) => setFollowUpDue(e.target.value)}
          />
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Logging…' : 'Log maintenance entry'}
      </Button>
    </form>
  )
}
