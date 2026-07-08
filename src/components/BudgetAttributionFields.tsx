'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface BudgetLineOption {
  id: string
  description: string
  cost_code_id: string
}

export interface AttributionCostCode {
  id: string
  code: string
  name: string
}

const NONE = '__none__'

/**
 * The paired "Cost code" + "Budget line" selects used everywhere spend is
 * attributed (add PO line, add cost, award package). The pairing rules live
 * here so all dialogs behave identically, mirroring what the server enforces:
 *
 * - Linking a budget line pulls the cost code along with it.
 * - Manually picking a code that contradicts the linked line unlinks the line
 *   (the server derives the code from the link, so a stale link would
 *   silently override the user's visible choice).
 */
export function BudgetAttributionFields({
  idPrefix,
  costCodes,
  budgetLines,
  costCodeId,
  budgetLineId,
  onChange,
  codeLabel = 'Cost code (optional)',
}: {
  idPrefix: string
  costCodes: AttributionCostCode[]
  budgetLines: BudgetLineOption[]
  costCodeId: string | null
  budgetLineId: string | null
  onChange: (next: { costCodeId: string | null; budgetLineId: string | null }) => void
  codeLabel?: string
}) {
  const linked = budgetLineId
    ? budgetLines.find((b) => b.id === budgetLineId) ?? null
    : null

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-code`}>{codeLabel}</Label>
        <Select
          value={costCodeId ?? NONE}
          onValueChange={(v) => {
            const next = !v || v === NONE ? null : v
            const keepLink = linked !== null && linked.cost_code_id === next
            onChange({ costCodeId: next, budgetLineId: keepLink ? budgetLineId : null })
          }}
        >
          <SelectTrigger id={`${idPrefix}-code`} className="w-full">
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
        <Label htmlFor={`${idPrefix}-line`}>Budget line (optional)</Label>
        <Select
          value={budgetLineId ?? NONE}
          onValueChange={(v) => {
            const next = !v || v === NONE ? null : v
            const bl = next ? budgetLines.find((b) => b.id === next) ?? null : null
            onChange({
              budgetLineId: next,
              costCodeId: bl ? bl.cost_code_id : costCodeId,
            })
          }}
        >
          <SelectTrigger id={`${idPrefix}-line`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No specific line</SelectItem>
            {budgetLines.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
