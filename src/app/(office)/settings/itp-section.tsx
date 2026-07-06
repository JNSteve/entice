'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  ITP_POINT_TYPES,
  ITP_POINT_TYPE_LABELS,
  type ItpPointType,
} from '@/lib/zod'
import {
  deleteItpTemplate,
  deleteItpTemplateItem,
  moveItpTemplateItem,
  setItpTemplateActive,
  upsertItpTemplate,
  upsertItpTemplateItem,
} from './itp-actions'

export type ItpTemplateRow = {
  id: string
  name: string
  activity: string
  discipline: string | null
  active: boolean
}

export type ItpTemplateItemRow = {
  id: string
  template_id: string
  position: number
  description: string
  acceptance_criteria: string
  spec_ref: string | null
  point_type: ItpPointType
  record_required: boolean
  responsible: string | null
}

const POINT_BADGE: Record<ItpPointType, string> = {
  hold: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  witness:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  surveillance:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
}

export function ItpSection({
  templates,
  items,
}: {
  templates: ItpTemplateRow[]
  items: ItpTemplateItemRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [editTemplate, setEditTemplate] = useState<ItpTemplateRow | null | 'new'>(null)
  const [itemsFor, setItemsFor] = useState<ItpTemplateRow | null>(null)

  const itemCount = new Map<string, number>()
  const holdCount = new Map<string, number>()
  for (const it of items) {
    itemCount.set(it.template_id, (itemCount.get(it.template_id) ?? 0) + 1)
    if (it.point_type === 'hold') {
      holdCount.set(it.template_id, (holdCount.get(it.template_id) ?? 0) + 1)
    }
  }

  function toggleActive(t: ItpTemplateRow) {
    startTransition(async () => {
      const res = await setItpTemplateActive(t.id, !t.active)
      if (res.error) toast.error(res.error)
      else toast.success(t.active ? 'Template deactivated' : 'Template activated')
    })
  }

  function remove(t: ItpTemplateRow) {
    if (!confirm(`Delete ITP template "${t.name}"? This cannot be undone.`)) return
    startTransition(async () => {
      const res = await deleteItpTemplate(t.id)
      if (res.error) toast.error(res.error)
      else toast.success('Template deleted')
    })
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">ITP templates</h2>
          <p className="text-sm text-muted-foreground">
            Reusable Inspection &amp; Test Plans (ISO 9001 8.5/8.6). Projects
            adopt a template, which copies its items — later edits here never
            change an in-flight ITP.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditTemplate('new')}
        >
          <PlusIcon className="size-4" />
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ITP templates yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Discipline</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Hold points</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} className={cn(!t.active && 'opacity-60')}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.activity}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.discipline ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {itemCount.get(t.id) ?? 0}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {holdCount.get(t.id) ?? 0}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={t.active}
                      disabled={pending}
                      onCheckedChange={() => toggleActive(t)}
                      aria-label={`Toggle ${t.name} active`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setItemsFor(t)}
                      >
                        <ListChecksIcon className="size-3.5" />
                        Items…
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title="Edit template"
                        onClick={() => setEditTemplate(t)}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title="Delete template"
                        disabled={pending}
                        onClick={() => remove(t)}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editTemplate && (
        <TemplateDialog
          template={editTemplate === 'new' ? null : editTemplate}
          onClose={() => setEditTemplate(null)}
        />
      )}
      {itemsFor && (
        <ItemsDialog
          template={itemsFor}
          items={items
            .filter((i) => i.template_id === itemsFor.id)
            .sort((a, b) => a.position - b.position)}
          onClose={() => setItemsFor(null)}
        />
      )}
    </section>
  )
}

// ─── Template dialog ──────────────────────────────────────────────────────────

function TemplateDialog({
  template,
  onClose,
}: {
  template: ItpTemplateRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(template?.name ?? '')
  const [activity, setActivity] = useState(template?.activity ?? '')
  const [discipline, setDiscipline] = useState(template?.discipline ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await upsertItpTemplate({
        id: template?.id,
        name,
        activity,
        discipline: discipline || null,
        active: template?.active ?? true,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(template ? 'Template updated' : 'Template created — now add its items')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {template ? 'Edit ITP template' : 'New ITP template'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="itp-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="itp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Flexible Pavement — Rev A"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="itp-activity">
              Activity <span className="text-destructive">*</span>
            </Label>
            <Input
              id="itp-activity"
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              placeholder="e.g. Flexible pavement construction"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="itp-discipline">Discipline</Label>
            <Input
              id="itp-discipline"
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              placeholder="e.g. Civil / Remediation"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !name.trim() || !activity.trim()}
            >
              {pending ? 'Saving…' : template ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Items builder dialog ─────────────────────────────────────────────────────

function ItemsDialog({
  template,
  items,
  onClose,
}: {
  template: ItpTemplateRow
  items: ItpTemplateItemRow[]
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [editItem, setEditItem] = useState<ItpTemplateItemRow | null | 'new'>(null)

  function move(item: ItpTemplateItemRow, direction: 'up' | 'down') {
    startTransition(async () => {
      const res = await moveItpTemplateItem(item.id, template.id, direction)
      if (res.error) toast.error(res.error)
    })
  }

  function remove(item: ItpTemplateItemRow) {
    if (!confirm('Delete this ITP item?')) return
    startTransition(async () => {
      const res = await deleteItpTemplateItem(item.id, template.id)
      if (res.error) toast.error(res.error)
      else toast.success('Item deleted')
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template.name} — items</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items yet — add the inspections and tests this plan covers.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Inspection / test</TableHead>
                    <TableHead>Point</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, idx) => (
                    <TableRow key={it.id}>
                      <TableCell className="tabular-nums">{it.position}</TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{it.description}</span>
                          <span className="text-xs text-muted-foreground">
                            {it.acceptance_criteria}
                            {it.spec_ref ? ` — ${it.spec_ref}` : ''}
                            {it.responsible ? ` · ${it.responsible}` : ''}
                            {it.record_required ? ' · Record required' : ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('text-xs', POINT_BADGE[it.point_type])}
                        >
                          {ITP_POINT_TYPE_LABELS[it.point_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Move up"
                            disabled={pending || idx === 0}
                            onClick={() => move(it, 'up')}
                          >
                            <ArrowUpIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Move down"
                            disabled={pending || idx === items.length - 1}
                            onClick={() => move(it, 'down')}
                          >
                            <ArrowDownIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Edit item"
                            onClick={() => setEditItem(it)}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Delete item"
                            disabled={pending}
                            onClick={() => remove(it)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditItem('new')}
            >
              <PlusIcon className="size-4" />
              Add item
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>

        {editItem && (
          <ItemDialog
            templateId={template.id}
            item={editItem === 'new' ? null : editItem}
            onClose={() => setEditItem(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Item dialog ──────────────────────────────────────────────────────────────

function ItemDialog({
  templateId,
  item,
  onClose,
}: {
  templateId: string
  item: ItpTemplateItemRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [description, setDescription] = useState(item?.description ?? '')
  const [criteria, setCriteria] = useState(item?.acceptance_criteria ?? '')
  const [specRef, setSpecRef] = useState(item?.spec_ref ?? '')
  const [pointType, setPointType] = useState<ItpPointType>(
    item?.point_type ?? 'surveillance'
  )
  const [recordRequired, setRecordRequired] = useState(
    item?.record_required ?? true
  )
  const [responsible, setResponsible] = useState(item?.responsible ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await upsertItpTemplateItem({
        id: item?.id,
        template_id: templateId,
        description,
        acceptance_criteria: criteria,
        spec_ref: specRef || null,
        point_type: pointType,
        record_required: recordRequired,
        responsible: responsible || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(item ? 'Item updated' : 'Item added')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit ITP item' : 'New ITP item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-description">
              Inspection / test <span className="text-destructive">*</span>
            </Label>
            <Input
              id="item-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Layer compaction testing"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-criteria">
              Acceptance criteria <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="item-criteria"
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={2}
              placeholder="e.g. Density ratio ≥ 95% Standard MDD"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-spec">Spec reference</Label>
              <Input
                id="item-spec"
                value={specRef}
                onChange={(e) => setSpecRef(e.target.value)}
                placeholder="e.g. AS 1289 5.4.1"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-point">Point type</Label>
              <Select
                value={pointType}
                onValueChange={(v) => v && setPointType(v as ItpPointType)}
              >
                <SelectTrigger id="item-point" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITP_POINT_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {ITP_POINT_TYPE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-responsible">Responsible</Label>
              <Input
                id="item-responsible"
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
                placeholder="e.g. NATA laboratory"
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox
                id="item-record"
                checked={recordRequired}
                onCheckedChange={(v) => setRecordRequired(v === true)}
              />
              <Label htmlFor="item-record" className="cursor-pointer">
                Record required
              </Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !description.trim() || !criteria.trim()}
            >
              {pending ? 'Saving…' : item ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
