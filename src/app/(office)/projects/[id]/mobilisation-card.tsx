'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import {
  addProjectChecklistItem,
  deleteProjectChecklistItem,
  toggleProjectChecklistItem,
} from '../actions'

export interface MobilisationItem {
  id: string
  text: string
  done: boolean
}

export function MobilisationCard({
  projectId,
  items,
}: {
  projectId: string
  items: MobilisationItem[]
}) {
  const [pending, startTransition] = useTransition()
  const [newText, setNewText] = useState('')

  const doneCount = items.filter((i) => i.done).length
  const allDone = items.length > 0 && doneCount === items.length

  function handleToggle(item: MobilisationItem) {
    startTransition(async () => {
      const result = await toggleProjectChecklistItem(item.id, projectId, !item.done)
      if (result.error) toast.error(result.error)
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newText.trim()) return
    startTransition(async () => {
      const result = await addProjectChecklistItem({
        project_id: projectId,
        text: newText.trim(),
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setNewText('')
    })
  }

  function handleDelete(item: MobilisationItem) {
    startTransition(async () => {
      const result = await deleteProjectChecklistItem(item.id, projectId)
      if (result.error) toast.error(result.error)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Mobilisation</span>
          {items.length > 0 && (
            <span
              className={cn(
                'text-sm font-medium tabular-nums',
                allDone
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-amber-700 dark:text-amber-400'
              )}
            >
              {doneCount}/{items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No mobilisation items. Add what must be in place before work starts.
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggle(item)}
              disabled={pending}
              aria-pressed={item.done}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded border-2',
                item.done
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-muted-foreground/40'
              )}
            >
              {item.done && <CheckIcon className="size-3.5" />}
            </button>
            <span
              className={cn(
                'flex-1 text-sm',
                item.done && 'text-muted-foreground line-through'
              )}
            >
              {item.text}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
              onClick={() => handleDelete(item)}
              disabled={pending}
            >
              <Trash2Icon className="size-3.5" />
              <span className="sr-only">Delete item</span>
            </Button>
          </div>
        ))}
        <form onSubmit={handleAdd} className="mt-1 flex items-center gap-2">
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add item…"
            className="h-8 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending || !newText.trim()}
          >
            <PlusIcon className="size-4" />
            <span className="sr-only">Add item</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
