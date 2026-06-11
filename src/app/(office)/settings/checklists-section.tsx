'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/EmptyState'
import { deleteChecklistTemplate, upsertChecklistTemplate } from './actions'
import {
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

export interface ChecklistTemplateRow {
  id: string
  title: string
  items: string[]
  created_at: string
}

export function ChecklistsSection({
  checklists,
}: {
  checklists: ChecklistTemplateRow[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Reusable checklists applied to jobs when they are created.
        </p>
        <ChecklistDialog />
      </div>
      {checklists.length === 0 ? (
        <EmptyState
          icon={<ListChecksIcon className="size-8" />}
          title="No checklist templates yet"
          description="Create a template to standardise job checklists."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {checklists.map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate">{template.title}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <ChecklistDialog template={template} />
                    <DeleteChecklistButton template={template} />
                  </span>
                </CardTitle>
                <CardDescription>
                  {template.items.length}{' '}
                  {template.items.length === 1 ? 'item' : 'items'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                  {template.items.slice(0, 5).map((item, i) => (
                    <li key={i} className="truncate">
                      {item}
                    </li>
                  ))}
                  {template.items.length > 5 && (
                    <li className="list-none text-xs">
                      +{template.items.length - 5} more…
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ChecklistDialog({ template }: { template?: ChecklistTemplateRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState(template?.title ?? '')
  const [items, setItems] = useState<string[]>(
    template?.items.length ? template.items : ['']
  )

  function reset() {
    if (!template) {
      setTitle('')
      setItems([''])
    }
  }

  function setItem(index: number, value: string) {
    setItems((prev) => prev.map((item, i) => (i === index ? value : item)))
  }

  function addItem() {
    setItems((prev) => [...prev, ''])
  }

  function removeItem(index: number) {
    setItems((prev) =>
      prev.length === 1 ? [''] : prev.filter((_, i) => i !== index)
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertChecklistTemplate({
        id: template?.id,
        title,
        items,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(template ? 'Checklist updated' : 'Checklist created')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      {template ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit checklist</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New checklist
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {template ? 'Edit checklist' : 'New checklist'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cl-title">Title</Label>
              <Input
                id="cl-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Site establishment"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Items</Label>
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={item}
                      onChange={(e) => setItem(i, e.target.value)}
                      placeholder={`Item ${i + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeItem(i)}
                      className="shrink-0"
                    >
                      <XIcon />
                      <span className="sr-only">Remove item</span>
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                className="self-start"
              >
                <PlusIcon />
                Add item
              </Button>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : template
                    ? 'Save changes'
                    : 'Create checklist'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DeleteChecklistButton({
  template,
}: {
  template: ChecklistTemplateRow
}) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`Delete checklist "${template.title}"?`)) return
    startTransition(async () => {
      const result = await deleteChecklistTemplate(template.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Checklist deleted')
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleDelete}
      disabled={pending}
    >
      <Trash2Icon className="text-destructive" />
      <span className="sr-only">Delete checklist</span>
    </Button>
  )
}
