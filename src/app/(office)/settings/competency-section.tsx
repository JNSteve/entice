'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import {
  COMPETENCY_CATEGORIES,
  COMPETENCY_CATEGORY_LABELS,
  WORKER_ROLES,
  WORKER_ROLE_LABELS,
  type CompetencyCategory,
  type WorkerRole,
} from '@/lib/zod'
import {
  deleteRoleRequirement,
  setCompetencyTypeActive,
  upsertCompetencyType,
  upsertRoleRequirement,
} from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import { AwardIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

export interface CompetencyTypeRow {
  id: string
  name: string
  category: CompetencyCategory
  validity_months: number | null
  is_system: boolean
  active: boolean
}

export interface RoleRequirementRow {
  id: string
  role: WorkerRole
  competency_type_id: string
  is_mandatory: boolean
}

// ─── Competency type dialog ───────────────────────────────────────────────────

function CompetencyTypeDialog({ type }: { type?: CompetencyTypeRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(type?.name ?? '')
  const [category, setCategory] = useState<CompetencyCategory>(type?.category ?? 'ticket')
  const [validity, setValidity] = useState(
    type?.validity_months != null ? String(type.validity_months) : ''
  )

  function reset() {
    setName(type?.name ?? '')
    setCategory(type?.category ?? 'ticket')
    setValidity(type?.validity_months != null ? String(type.validity_months) : '')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertCompetencyType({
        id: type?.id,
        name: name.trim(),
        category,
        validity_months: validity.trim() === '' ? null : Number(validity),
        active: type?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(type ? 'Competency type updated' : 'Competency type added')
      setOpen(false)
      if (!type) reset()
    })
  }

  return (
    <>
      {type ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Edit"
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          <PlusIcon className="size-4" />
          New type
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{type ? 'Edit competency type' : 'New competency type'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-name">Name</Label>
              <Input
                id="ct-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HRWL — Crane (C6)"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory((v as CompetencyCategory) ?? 'ticket')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPETENCY_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {COMPETENCY_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-validity">
                  Validity (months){' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    blank = no expiry
                  </span>
                </Label>
                <Input
                  id="ct-validity"
                  type="number"
                  min={1}
                  value={validity}
                  onChange={(e) => setValidity(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? 'Saving…' : type ? 'Save' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Requirement dialog ───────────────────────────────────────────────────────

function RequirementDialog({ types }: { types: CompetencyTypeRow[] }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [role, setRole] = useState<WorkerRole>('field')
  const [typeId, setTypeId] = useState('')
  const [mandatory, setMandatory] = useState(true)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!typeId) {
      toast.error('Pick a competency type')
      return
    }
    startTransition(async () => {
      const result = await upsertRoleRequirement({
        role,
        competency_type_id: typeId,
        is_mandatory: mandatory,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Requirement added')
      setOpen(false)
      setTypeId('')
      setMandatory(true)
    })
  }

  const activeTypes = types.filter((t) => t.active)

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New requirement
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New role requirement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole((v as WorkerRole) ?? 'field')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {WORKER_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Competency type</Label>
              <Select value={typeId} onValueChange={(v) => setTypeId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a type…" />
                </SelectTrigger>
                <SelectContent>
                  {activeTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
              />
              Mandatory (roster warnings + needs-attention card)
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !typeId}>
                {pending ? 'Saving…' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DeleteRequirementButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Remove requirement"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (!confirm('Remove this requirement?')) return
        startTransition(async () => {
          const result = await deleteRoleRequirement(id)
          if (result.error) {
            toast.error(result.error)
            return
          }
          toast.success('Requirement removed')
        })
      }}
    >
      <Trash2Icon className="size-3.5" />
    </Button>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function CompetencySection({
  types,
  requirements,
}: {
  types: CompetencyTypeRow[]
  requirements: RoleRequirementRow[]
}) {
  const typeById = new Map(types.map((t) => [t.id, t]))
  const sortedRequirements = [...requirements].sort(
    (a, b) =>
      WORKER_ROLES.indexOf(a.role) - WORKER_ROLES.indexOf(b.role) ||
      (typeById.get(a.competency_type_id)?.name ?? '').localeCompare(
        typeById.get(b.competency_type_id)?.name ?? ''
      )
  )

  return (
    <div className="flex flex-col gap-8">
      {/* Types */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Competency types — the licences, tickets, VOCs and inductions
            recorded on the training register. Validity prefills the expiry
            when a record is added.
          </p>
          <CompetencyTypeDialog />
        </div>
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (r: CompetencyTypeRow) => (
                <span className="font-medium">{r.name}</span>
              ),
            },
            {
              key: 'category',
              header: 'Category',
              render: (r: CompetencyTypeRow) => (
                <Badge variant="secondary">
                  {COMPETENCY_CATEGORY_LABELS[r.category]}
                </Badge>
              ),
            },
            {
              key: 'validity',
              header: 'Validity',
              render: (r: CompetencyTypeRow) =>
                r.validity_months ? `${r.validity_months} months` : 'No expiry',
            },
            {
              key: 'active',
              header: 'Status',
              render: (r: CompetencyTypeRow) => <ActiveBadge active={r.active} />,
            },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              render: (r: CompetencyTypeRow) => (
                <div className="flex items-center justify-end gap-1">
                  <CompetencyTypeDialog type={r} />
                  <ToggleActiveButton
                    active={r.active}
                    label={r.name}
                    onToggle={(active) => setCompetencyTypeActive(r.id, active)}
                  />
                </div>
              ),
            },
          ]}
          rows={types}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<AwardIcon className="size-8" />}
              title="No competency types"
              description="Add the licences, tickets and inductions your workers must hold."
            />
          }
        />
      </div>

      {/* Role requirements */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Role requirements — which competencies each role must hold. These
            drive the matrix, the needs-attention card and the schedule
            assignment warnings (warn only, never blocking).
          </p>
          <RequirementDialog types={types} />
        </div>
        <DataTable
          columns={[
            {
              key: 'role',
              header: 'Role',
              render: (r: RoleRequirementRow) => (
                <Badge variant="outline" className="capitalize">
                  {WORKER_ROLE_LABELS[r.role]}
                </Badge>
              ),
            },
            {
              key: 'type',
              header: 'Competency',
              render: (r: RoleRequirementRow) => (
                <span className="font-medium">
                  {typeById.get(r.competency_type_id)?.name ?? '—'}
                </span>
              ),
            },
            {
              key: 'mandatory',
              header: 'Mandatory',
              render: (r: RoleRequirementRow) =>
                r.is_mandatory ? (
                  <Badge variant="secondary">Mandatory</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">Desirable</span>
                ),
            },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              render: (r: RoleRequirementRow) => (
                <div className="flex justify-end">
                  <DeleteRequirementButton id={r.id} />
                </div>
              ),
            },
          ]}
          rows={sortedRequirements}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<AwardIcon className="size-8" />}
              title="No role requirements"
              description="Map each role to the competencies it must hold."
            />
          }
        />
      </div>
    </div>
  )
}
