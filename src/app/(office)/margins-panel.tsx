'use client'

import Link from 'next/link'
import { useState } from 'react'
import { TrendingUpIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { aud, fmtDate } from '@/lib/format'
import { drawdownTone } from '@/lib/pnl'
import {
  CLOSED_PERIODS,
  closedInPeriod,
  sortLive,
  summariseClosed,
  summariseLive,
  type ClosedPeriod,
  type PortfolioRow,
} from '@/lib/pnl-portfolio'
import { cn } from '@/lib/utils'

const LIVE_ROWS = 10
const PERIOD_KEY = 'margins.period'
const TONE_BAR = { ok: 'bg-emerald-600', warn: 'bg-amber-500', over: 'bg-red-600' } as const

function pct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`
}

function money(n: number | null): string {
  if (n == null) return '—'
  return n < 0 ? `−${aud(Math.abs(n))}` : aud(n)
}

export interface MarginsData {
  rows: PortfolioRow[]
  today: string
}

export function MarginsPanel({ data }: { data: MarginsData | null }) {
  const [tab, setTab] = useState<'live' | 'closed'>('live')

  return (
    <Card size="sm" className="md:col-span-2 xl:col-span-3">
      <CardHeader>
        <CardTitle className="text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-950"
            >
              <TrendingUpIcon className="size-3.5 text-emerald-700 dark:text-emerald-300" />
            </span>
            Job margins
            <span className="text-xs font-normal text-muted-foreground">All figures ex GST</span>
            <Segmented
              className="ml-auto"
              label="Margins view"
              value={tab}
              onChange={setTab}
              options={[
                { key: 'live', label: 'Live' },
                { key: 'closed', label: 'Closed out' },
              ]}
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data === null ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this card.</p>
        ) : tab === 'live' ? (
          <LiveView rows={data.rows.filter((r) => r.stage === 'live')} />
        ) : (
          <ClosedView rows={data.rows} today={data.today} />
        )}
      </CardContent>
    </Card>
  )
}

function LiveView({ rows }: { rows: PortfolioRow[] }) {
  const [showAll, setShowAll] = useState(false)
  const summary = summariseLive(rows)
  const sorted = sortLive(rows)
  const visible = showAll ? sorted : sorted.slice(0, LIVE_ROWS)

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No live jobs or projects.</p>
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Live contract value" value={aud(summary.contractValue)} />
        <Tile label="Cost to date" value={aud(summary.cost)} />
        <Tile
          label="Headroom"
          value={money(summary.headroom)}
          sub="price − cost to date"
          tone={summary.headroom < 0 ? 'bad' : undefined}
        />
        <Tile
          label="At risk"
          value={String(summary.atRisk)}
          sub="over 80% drawn down or over price"
          tone={summary.atRisk > 0 ? 'warn' : undefined}
        />
      </div>
      {summary.unpriced > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.unpriced} live {summary.unpriced === 1 ? 'job has' : 'jobs have'} no price set and
          {summary.unpriced === 1 ? ' is' : ' are'} left out of the totals.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job / project</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Cost to date</TableHead>
              <TableHead className="text-right">Headroom</TableHead>
              <TableHead className="w-44">Drawdown</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={`${r.kind}:${r.id}`}>
                <TableCell>
                  <RowLink row={r} />
                  {r.pendingHours > 0 && (
                    <div className="text-xs text-muted-foreground">
                      +{r.pendingHours} h unapproved
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.price != null ? aud(r.price) : <span className="text-muted-foreground">No price</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{aud(r.cost)}</TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', (r.margin ?? 0) < 0 && 'text-red-600')}
                >
                  {money(r.margin)}
                </TableCell>
                <TableCell>
                  <DrawdownBar pct={r.drawdownPct} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {sorted.length > LIVE_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {showAll ? 'Show worst 10' : `Show all ${sorted.length}`}
        </button>
      )}
    </>
  )
}

function readPeriod(): ClosedPeriod {
  try {
    const v = window.localStorage.getItem(PERIOD_KEY)
    if (CLOSED_PERIODS.some((p) => p.key === v)) return v as ClosedPeriod
  } catch {
    // storage blocked — fall back to the default
  }
  return 'fy'
}

function ClosedView({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  // Only mounted after the tab is clicked (client-side), so storage is safe here.
  const [period, setPeriod] = useState<ClosedPeriod>(readPeriod)

  function choose(p: ClosedPeriod) {
    setPeriod(p)
    try {
      window.localStorage.setItem(PERIOD_KEY, p)
    } catch {
      // not persisted — fine
    }
  }

  const closed = closedInPeriod(rows, period, today).sort((a, b) =>
    (b.closedOn ?? '').localeCompare(a.closedOn ?? '')
  )
  const s = summariseClosed(closed)

  return (
    <>
      <Segmented
        label="Closed out period"
        value={period}
        onChange={choose}
        options={CLOSED_PERIODS}
      />
      {closed.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing closed out in this period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Closed out" value={String(s.count)} />
            <Tile label="Revenue" value={aud(s.revenue)} />
            <Tile label="Cost" value={aud(s.cost)} />
            <Tile label="Margin earned" value={money(s.margin)} tone={s.margin < 0 ? 'bad' : undefined} />
            <Tile
              label="Average margin"
              value={pct(s.avgMarginPct)}
              sub="weighted by price"
              tone={(s.avgMarginPct ?? 0) < 0 ? 'bad' : undefined}
            />
          </div>
          {(s.best || s.worst) && (
            <p className="text-sm text-muted-foreground">
              {s.best && (
                <>
                  Best: <RowLink row={s.best} /> {pct(s.best.marginPct)}
                </>
              )}
              {s.worst && (
                <>
                  {' · '}Worst: <RowLink row={s.worst} />{' '}
                  <span className={cn((s.worst.marginPct ?? 0) < 0 && 'text-red-600')}>
                    {pct(s.worst.marginPct)}
                  </span>
                </>
              )}
            </p>
          )}
          {s.unpriced > 0 && (
            <p className="text-xs text-muted-foreground">
              {s.unpriced} closed {s.unpriced === 1 ? 'job has' : 'jobs have'} no price and
              {s.unpriced === 1 ? ' is' : ' are'} left out of revenue, cost and margin.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job / project</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closed.map((r) => {
                  const loss = (r.margin ?? 0) < 0
                  return (
                    <TableRow key={`${r.kind}:${r.id}`}>
                      <TableCell>
                        <RowLink row={r} />
                      </TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">
                        {r.closedOn ? fmtDate(r.closedOn) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.price != null ? aud(r.price) : <span className="text-muted-foreground">No price</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{aud(r.cost)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', loss && 'text-red-600')}>
                        {money(r.margin)}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', loss && 'text-red-600')}>
                        {pct(r.marginPct)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  )
}

function RowLink({ row }: { row: PortfolioRow }) {
  return (
    <Link href={row.href} className="hover:underline">
      <span className="font-mono">{row.number}</span> — {row.title}
    </Link>
  )
}

function DrawdownBar({ pct: value }: { pct: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>
  const tone = drawdownTone(value)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', TONE_BAR[tone])}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
      <span
        className={cn(
          'w-12 text-right text-xs tabular-nums',
          tone === 'warn' && 'text-amber-600',
          tone === 'over' && 'text-red-600'
        )}
      >
        {value.toFixed(0)}%
      </span>
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'warn' | 'bad'
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-base font-semibold tabular-nums',
          tone === 'warn' && 'text-amber-600',
          tone === 'bad' && 'text-red-600'
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Segmented<K extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: K
  onChange: (k: K) => void
  options: { key: K; label: string }[]
  className?: string
}) {
  return (
    <div
      className={cn('inline-flex w-fit flex-wrap rounded-lg border p-0.5 text-sm font-normal', className)}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-2.5 py-0.5 transition-colors',
            value === o.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
