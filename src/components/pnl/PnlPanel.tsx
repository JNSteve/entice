'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { aud } from '@/lib/format'
import { COST_CATEGORIES, drawdownTone, withGst } from '@/lib/pnl'
import type { PnlData } from '@/lib/pnl-queries'
import { cn } from '@/lib/utils'
import { CostLinesTable } from './CostLinesTable'
import { PriceAdjustments } from './PriceAdjustments'

interface PnlPanelProps {
  parentType: 'job' | 'project'
  parentId: string
  data: PnlData
  /** Project only — where the approved variations come from. */
  variationsHref?: string
  /** Job/project number, used in the supplier-import dialog. */
  parentLabel?: string
}

const TONE_BAR = { ok: 'bg-emerald-600', warn: 'bg-amber-500', over: 'bg-red-600' } as const
const TONE_TEXT = { ok: '', warn: 'text-amber-600', over: 'text-red-600' } as const

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`
}

export function PnlPanel({ parentType, parentId, data, variationsHref, parentLabel }: PnlPanelProps) {
  const { summary, price, costLines, workers, costCodes, gstRate } = data
  const tone = drawdownTone(summary.drawdownPct)
  const categories = COST_CATEGORIES.filter((c) => summary.byCategory[c.key] !== 0)

  return (
    <div className="flex flex-col gap-6">
      {/* Summary strip */}
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          All figures are <span className="font-medium text-foreground">ex GST</span>. GST is passed
          through to the ATO, so it isn&apos;t part of price, cost or margin.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            label="Price (ex GST)"
            value={summary.price != null ? aud(summary.price) : 'No price set'}
            sub={summary.price != null ? `${aud(withGst(summary.price, gstRate))} inc GST` : undefined}
          />
          <Tile label="Cost to date (ex GST)" value={aud(summary.cost)} />
          <Tile
            label="Margin (ex GST)"
            value={summary.margin != null ? aud(summary.margin) : '—'}
            sub={summary.marginPct != null ? `${pct(summary.marginPct)} of price` : undefined}
            className={summary.margin != null && summary.margin < 0 ? 'text-red-600' : undefined}
          />
          <Tile
            label="Drawdown"
            value={pct(summary.drawdownPct)}
            sub={summary.drawdownPct != null ? 'of price used by cost' : undefined}
            className={TONE_TEXT[tone]}
          />
        </div>
        {summary.drawdownPct != null && (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Price drawn down by cost"
            aria-valuenow={Math.round(summary.drawdownPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn('h-full rounded-full transition-all', TONE_BAR[tone])}
              style={{ width: `${Math.min(Math.max(summary.drawdownPct, 0), 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Price */}
        {price.mode === 'job' ? (
          <PriceAdjustments
            jobId={parentId}
            basePrice={price.basePrice}
            hasQuote={price.hasQuote}
            quoteNumber={price.quoteNumber}
            adjustments={price.adjustments}
            price={summary.price}
            gstRate={gstRate}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Price (ex GST)</h3>
            <div className="rounded-xl border text-sm">
              <Row label="Contract sum" value={aud(price.contractSum)} />
              <Row
                label={
                  variationsHref ? (
                    <Link href={variationsHref} className="underline underline-offset-2">
                      Approved variations
                    </Link>
                  ) : (
                    'Approved variations'
                  )
                }
                value={aud(price.approvedVariations)}
                bordered
              />
              <Row label="Current price" value={summary.price != null ? aud(summary.price) : '—'} bordered strong />
            </div>
          </div>
        )}

        {/* Breakdown */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Cost breakdown</h3>
          <div className="rounded-xl border text-sm">
            {categories.length === 0 ? (
              <p className="px-4 py-2.5 text-muted-foreground">No costs yet.</p>
            ) : (
              categories.map((c, i) => (
                <Row
                  key={c.key}
                  label={c.label}
                  value={
                    <>
                      <span className="mr-3 text-muted-foreground">
                        {pct(summary.cost ? (summary.byCategory[c.key] / summary.cost) * 100 : null)}
                      </span>
                      {aud(summary.byCategory[c.key])}
                    </>
                  }
                  bordered={i > 0}
                />
              ))
            )}
            <Row label="Total cost" value={aud(summary.cost)} bordered strong />
          </div>
        </div>
      </div>

      {/* Timesheet labour */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Labour from timesheets (approved)</h3>
        {summary.timesheetLabour.workers.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.timesheetLabour.workers.map((w) => (
                  <TableRow key={`${w.userId}:${w.rate ?? 'none'}`}>
                    <TableCell>{w.workerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.hours}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.missingRate ? <Badge variant="outline">No rate set</Badge> : aud(w.rate!)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{aud(w.cost)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium bg-muted/50">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{summary.timesheetLabour.hours}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{aud(summary.timesheetLabour.cost)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No approved timesheet hours yet.</p>
        )}
        {summary.pendingHours > 0 && (
          <p className="text-sm text-muted-foreground">
            Pending: {summary.pendingHours} h unapproved or still clocked on — not counted until approved.
          </p>
        )}
        {summary.timesheetLabour.workers.some((w) => w.missingRate) && (
          <p className="text-sm text-amber-600">
            Some approved hours have no rate. Set the worker&apos;s hourly cost in Settings → Users, then
            un-approve and re-approve those entries to cost them.
          </p>
        )}
      </div>

      <CostLinesTable
        parentType={parentType}
        parentId={parentId}
        lines={costLines}
        workers={workers}
        costCodes={costCodes}
        gstRate={gstRate}
        parentLabel={parentLabel}
      />
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  className,
}: {
  label: string
  value: string
  sub?: string
  className?: string
}) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', className)}>{value}</div>
      {sub && <div className={cn('text-xs tabular-nums text-muted-foreground', className)}>{sub}</div>}
    </div>
  )
}

function Row({
  label,
  value,
  bordered,
  strong,
}: {
  label: React.ReactNode
  value: React.ReactNode
  bordered?: boolean
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-4 px-4 py-2.5',
        bordered && 'border-t',
        strong && 'bg-muted/50 font-medium'
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
