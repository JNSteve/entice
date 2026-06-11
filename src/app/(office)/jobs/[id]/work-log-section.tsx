'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PlusIcon } from 'lucide-react'
import { addWorkLog } from '../actions'
import { fmtDate } from '@/lib/format'

interface WorkLogEntry {
  id: string
  date: string
  notes: string
  created_by_name: string | null
}

interface WorkLogSectionProps {
  jobId: string
  entries: WorkLogEntry[]
}

export function WorkLogSection({ jobId, entries }: WorkLogSectionProps) {
  const [pending, startTransition] = useTransition()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!notes.trim()) return
    startTransition(async () => {
      const result = await addWorkLog({ job_id: jobId, date, notes: notes.trim() })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Work log entry added')
      setNotes('')
    })
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Work log</h2>

      {sorted.length > 0 ? (
        <div className="rounded-xl border divide-y">
          {sorted.map((entry) => (
            <div key={entry.id} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium tabular-nums">{fmtDate(entry.date)}</span>
                {entry.created_by_name && (
                  <span className="text-xs text-muted-foreground">{entry.created_by_name}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{entry.notes}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No work log entries yet.</p>
      )}

      {/* Add entry */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
        <h3 className="text-sm font-medium">Add entry</h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-date">Date</Label>
          <Input
            id="wl-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-notes">Notes</Label>
          <Textarea
            id="wl-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Work performed today…"
            rows={3}
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={pending || !notes.trim()} className="self-start">
          <PlusIcon className="size-4" />
          {pending ? 'Adding…' : 'Add entry'}
        </Button>
      </form>
    </section>
  )
}
