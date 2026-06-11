'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Trash2Icon, PlusIcon } from 'lucide-react'
import {
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  applyChecklistTemplate,
} from '../actions'
import { fmtDate } from '@/lib/format'

interface ChecklistItem {
  id: string
  text: string
  done: boolean
  done_at: string | null
  done_by_name: string | null
  position: number
}

interface Template {
  id: string
  title: string
}

interface ChecklistSectionProps {
  jobId: string
  items: ChecklistItem[]
  templates: Template[]
}

export function ChecklistSection({ jobId, items, templates }: ChecklistSectionProps) {
  const [pending, startTransition] = useTransition()
  const [newText, setNewText] = useState('')
  const [templateId, setTemplateId] = useState('')

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newText.trim()) return
    startTransition(async () => {
      const result = await addChecklistItem({ job_id: jobId, text: newText.trim() })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setNewText('')
    })
  }

  function handleToggle(item: ChecklistItem) {
    startTransition(async () => {
      const result = await toggleChecklistItem(item.id, jobId, !item.done)
      if (result.error) {
        toast.error(result.error)
      }
    })
  }

  function handleDelete(itemId: string) {
    if (!confirm('Delete this checklist item?')) return
    startTransition(async () => {
      const result = await deleteChecklistItem(itemId, jobId)
      if (result.error) {
        toast.error(result.error)
      }
    })
  }

  function handleApplyTemplate() {
    if (!templateId) return
    startTransition(async () => {
      const result = await applyChecklistTemplate(jobId, templateId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setTemplateId('')
      toast.success('Template applied')
    })
  }

  const sorted = [...items].sort((a, b) => a.position - b.position)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Checklist</h2>
        <span className="text-sm text-muted-foreground">
          {items.filter((i) => i.done).length}/{items.length} done
        </span>
      </div>

      {/* Apply template */}
      {templates.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Apply template…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleApplyTemplate}
            disabled={!templateId || pending}
          >
            Apply
          </Button>
        </div>
      )}

      {/* Items */}
      {sorted.length > 0 ? (
        <div className="rounded-xl border divide-y">
          {sorted.map((item) => (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3">
              <Checkbox
                id={`chk-${item.id}`}
                checked={item.done}
                onCheckedChange={() => handleToggle(item)}
                disabled={pending}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <label
                  htmlFor={`chk-${item.id}`}
                  className={`text-sm cursor-pointer ${item.done ? 'line-through text-muted-foreground' : ''}`}
                >
                  {item.text}
                </label>
                {item.done && item.done_at && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Done {fmtDate(item.done_at)}{item.done_by_name ? ` by ${item.done_by_name}` : ''}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => handleDelete(item.id)}
                disabled={pending}
              >
                <Trash2Icon className="size-4 text-destructive" />
                <span className="sr-only">Delete</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No checklist items yet.</p>
      )}

      {/* Add item */}
      <form onSubmit={handleAddItem} className="flex items-center gap-2">
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add checklist item…"
          className="flex-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending || !newText.trim()}>
          <PlusIcon className="size-4" />
          Add
        </Button>
      </form>
    </section>
  )
}
