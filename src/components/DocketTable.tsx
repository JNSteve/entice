'use client'

import React, { useState, useTransition } from 'react'
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
import { MoneyInput } from '@/components/MoneyInput'
import { FileTextIcon, PlusIcon } from 'lucide-react'
import { fmtDate } from '@/lib/format'
import { createCostFromDocket } from '@/lib/docket-actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocketRow {
  id: string
  filename: string
  caption: string | null
  signedUrl: string | null
  created_at: string
  created_by_name: string | null
  meta: {
    supplier?: string | null
    docket_no?: string | null
    docket_date?: string | null
    cost_id?: string | null
  } | null
}

export interface CostCodeOption {
  id: string
  code: string
  name: string
}

interface DocketTableProps {
  rows: DocketRow[]
  parentType: 'job' | 'project'
  parentId: string
  costCodes: CostCodeOption[]
  canCreateCost: boolean
}

const NONE = 'none'

// ─── Create cost dialog ───────────────────────────────────────────────────────

function CreateCostDialog({
  docket,
  parentType,
  parentId,
  costCodes,
  open,
  onClose,
}: {
  docket: DocketRow
  parentType: 'job' | 'project'
  parentId: string
  costCodes: CostCodeOption[]
  open: boolean
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const defaultDesc = [docket.meta?.supplier, docket.meta?.docket_no]
    .filter(Boolean)
    .join(' docket ')
    || docket.filename

  const [date, setDate] = useState(
    docket.meta?.docket_date ?? new Date().toISOString().slice(0, 10)
  )
  const [description, setDescription] = useState(defaultDesc)
  const [amount, setAmount] = useState<number | null>(null)
  const [costCodeId, setCostCodeId] = useState(NONE)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || amount <= 0) {
      toast.error('Amount must be positive')
      return
    }
    startTransition(async () => {
      const result = await createCostFromDocket({
        attachment_id: docket.id,
        parent_type: parentType,
        parent_id: parentId,
        date,
        description,
        amount,
        cost_code_id: costCodeId === NONE ? null : costCodeId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Cost created')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create cost from docket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex flex-col gap-0.5">
            {docket.meta?.supplier && <span>Supplier: {docket.meta.supplier}</span>}
            {docket.meta?.docket_no && <span>Docket no: {docket.meta.docket_no}</span>}
            {docket.meta?.docket_date && <span>Docket date: {fmtDate(docket.meta.docket_date)}</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cfd-date">Date</Label>
            <Input
              id="cfd-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cfd-desc">Description</Label>
            <Input
              id="cfd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cfd-code">Cost code (optional)</Label>
            <Select value={costCodeId} onValueChange={(v) => setCostCodeId(v ?? NONE)}>
              <SelectTrigger id="cfd-code" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No cost code</SelectItem>
                {costCodes.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.code} – {cc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cfd-amount">Amount</Label>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !amount}>
              {pending ? 'Creating…' : 'Create cost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DocketTable({
  rows,
  parentType,
  parentId,
  costCodes,
  canCreateCost,
}: DocketTableProps) {
  const [activeDocket, setActiveDocket] = useState<DocketRow | null>(null)

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No dockets yet.</p>
  }

  return (
    <>
      <div className="rounded-xl border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Supplier</TableHead>
              <TableHead>Docket no</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Caption</TableHead>
              <TableHead>Uploaded by</TableHead>
              {canCreateCost && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.signedUrl ? (
                    <a
                      href={row.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-8 h-8 rounded border overflow-hidden bg-muted shrink-0"
                      aria-label={`Open ${row.filename}`}
                    >
                      {row.filename.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <img
                          src={row.signedUrl}
                          alt={row.caption ?? row.filename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex items-center justify-center w-full h-full">
                          <FileTextIcon className="size-4 text-muted-foreground" />
                        </div>
                      )}
                    </a>
                  ) : (
                    <div className="w-8 h-8 rounded border bg-muted flex items-center justify-center">
                      <FileTextIcon className="size-4 text-muted-foreground" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {row.meta?.supplier ? (
                    <span>{row.meta.supplier}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.meta?.docket_no ? (
                    <span>{row.meta.docket_no}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums text-sm">
                  {row.meta?.docket_date ? fmtDate(row.meta.docket_date) : fmtDate(row.created_at)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                  {row.caption ?? '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.created_by_name ?? '—'}
                </TableCell>
                {canCreateCost && (
                  <TableCell>
                    {row.meta?.cost_id ? (
                      <span className="text-xs text-muted-foreground">Cost linked</span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveDocket(row)}
                      >
                        <PlusIcon className="size-3.5 mr-1" />
                        Create cost
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {activeDocket && (
        <CreateCostDialog
          docket={activeDocket}
          parentType={parentType}
          parentId={parentId}
          costCodes={costCodes}
          open={!!activeDocket}
          onClose={() => setActiveDocket(null)}
        />
      )}
    </>
  )
}
