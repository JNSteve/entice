'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MoneyInput } from '@/components/MoneyInput'
import { Trash2Icon } from 'lucide-react'
import { createPackage, updatePackage, deletePackage } from './actions'
import type { PackageRow, CostCodeOption, OwnerOption } from './packages-table'

// ─── Shared props ──────────────────────────────────────────────────────────────

interface PackageDialogProps {
  projectId: string
  pkg?: PackageRow            // undefined = new
  costCodes: CostCodeOption[]
  owners: OwnerOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NONE = '__none__'

export function PackageDialog({
  projectId,
  pkg,
  costCodes,
  owners,
  open,
  onOpenChange,
}: PackageDialogProps) {
  const isNew = !pkg

  const [pending, startTransition] = useTransition()
  const [deletePending, startDeleteTransition] = useTransition()

  const [name, setName] = useState(pkg?.name ?? '')
  const [budget, setBudget] = useState<number | null>(pkg?.budget_amount ?? null)
  const [costCodeId, setCostCodeId] = useState<string>(pkg?.cost_code_id ?? NONE)
  const [ownerId, setOwnerId] = useState<string>(pkg?.owner_id ?? NONE)

  function handleCostCodeChange(v: string | null) {
    setCostCodeId(v ?? NONE)
  }
  function handleOwnerChange(v: string | null) {
    setOwnerId(v ?? NONE)
  }
  const [letByDate, setLetByDate] = useState(pkg?.let_by_date ?? '')
  const [notes, setNotes] = useState(pkg?.notes ?? '')

  function reset() {
    setName('')
    setBudget(null)
    setCostCodeId(NONE)
    setOwnerId(NONE)
    setLetByDate('')
    setNotes('')
  }

  const canDelete =
    !isNew && pkg?.status === 'planned'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        project_id: projectId,
        name: name.trim(),
        budget_amount: budget ?? 0,
        cost_code_id: costCodeId === NONE ? null : costCodeId,
        owner_id: ownerId === NONE ? null : ownerId,
        let_by_date: letByDate || null,
        notes: notes || null,
      }

      let result: { error?: string; id?: string } | { error?: string }
      if (isNew) {
        result = await createPackage(payload)
      } else {
        result = await updatePackage(pkg!.id, projectId, {
          name: payload.name,
          budget_amount: payload.budget_amount,
          cost_code_id: payload.cost_code_id,
          owner_id: payload.owner_id,
          let_by_date: payload.let_by_date,
          notes: payload.notes,
        })
      }

      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(isNew ? 'Package created' : 'Package updated')
      onOpenChange(false)
      if (isNew) reset()
    })
  }

  function handleDelete() {
    if (!pkg) return
    if (!confirm(`Delete package "${pkg.name}"? This cannot be undone.`)) return
    startDeleteTransition(async () => {
      const result = await deletePackage(pkg.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Package deleted')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v && isNew) reset() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New package' : 'Edit package'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pkg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Electrical"
              required
            />
          </div>

          {/* Budget */}
          <div className="flex flex-col gap-1.5">
            <Label>Budget</Label>
            <MoneyInput
              value={budget}
              onChange={setBudget}
              placeholder="0.00"
            />
          </div>

          {/* Cost code */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-costcode">Cost code</Label>
            <Select value={costCodeId} onValueChange={handleCostCodeChange}>
              <SelectTrigger id="pkg-costcode">
                <SelectValue placeholder="Select cost code…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {costCodes.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.code} — {cc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Owner */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-owner">Owner</Label>
            <Select value={ownerId} onValueChange={handleOwnerChange}>
              <SelectTrigger id="pkg-owner">
                <SelectValue placeholder="Select owner…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Let-by date */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-letby">Let-by date</Label>
            <Input
              id="pkg-letby"
              type="date"
              value={letByDate}
              onChange={(e) => setLetByDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pkg-notes">Notes</Label>
            <Textarea
              id="pkg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes…"
              rows={2}
            />
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {canDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deletePending}
                onClick={handleDelete}
                className="sm:mr-auto"
              >
                <Trash2Icon className="size-4" />
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => { onOpenChange(false); if (isNew) reset() }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending
                ? isNew ? 'Creating…' : 'Saving…'
                : isNew ? 'Create package' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
