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
import { COST_CODE_CATEGORIES, type CostCodeCategory } from '@/lib/zod'
import { setCostCodeActive, upsertCostCode } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import { HashIcon, PencilIcon, PlusIcon } from 'lucide-react'

export interface CostCodeRow {
  id: string
  code: string
  name: string
  category: CostCodeCategory
  active: boolean
}

const CATEGORY_LABELS: Record<CostCodeCategory, string> = {
  labour: 'Labour',
  plant: 'Plant',
  materials: 'Materials',
  subcontract: 'Subcontract',
  other: 'Other',
}

export function CostCodesSection({ costCodes }: { costCodes: CostCodeRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Cost codes group budgets and costs on jobs and projects.
        </p>
        <CostCodeDialog />
      </div>
      <DataTable
        columns={[
          {
            key: 'code',
            header: 'Code',
            className: 'w-20',
            render: (r: CostCodeRow) => (
              <span className="font-medium tabular-nums">{r.code}</span>
            ),
          },
          {
            key: 'name',
            header: 'Name',
            render: (r: CostCodeRow) => r.name,
          },
          {
            key: 'category',
            header: 'Category',
            render: (r: CostCodeRow) => (
              <Badge variant="secondary">
                {CATEGORY_LABELS[r.category] ?? r.category}
              </Badge>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: CostCodeRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: CostCodeRow) => (
              <div className="flex items-center justify-end gap-1">
                <CostCodeDialog costCode={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={`${r.code} ${r.name}`}
                  onToggle={(active) => setCostCodeActive(r.id, active)}
                />
              </div>
            ),
          },
        ]}
        rows={costCodes}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<HashIcon className="size-8" />}
            title="No cost codes yet"
            description="Add cost codes to structure budgets and cost tracking."
          />
        }
      />
    </div>
  )
}

function CostCodeDialog({ costCode }: { costCode?: CostCodeRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [code, setCode] = useState(costCode?.code ?? '')
  const [name, setName] = useState(costCode?.name ?? '')
  const [category, setCategory] = useState<CostCodeCategory>(
    costCode?.category ?? 'other'
  )

  function reset() {
    if (!costCode) {
      setCode('')
      setName('')
      setCategory('other')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertCostCode({
        id: costCode?.id,
        code,
        name,
        category,
        active: costCode?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(costCode ? 'Cost code updated' : 'Cost code added')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      {costCode ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit cost code</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New cost code
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {costCode ? 'Edit cost code' : 'New cost code'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-code">Code</Label>
              <Input
                id="cc-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="10"
                className="max-w-28"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-name">Name</Label>
              <Input
                id="cc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Labour"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-category">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as CostCodeCategory)}
              >
                <SelectTrigger id="cc-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COST_CODE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : costCode ? 'Save changes' : 'Add cost code'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
