'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  areaM2,
  lengthM,
  polygonAreaPt2,
  polylineLengthPt,
  scaleFromCalibration,
  type Pt,
} from '@/lib/takeoff'
import {
  CrosshairIcon,
  HashIcon,
  MinusIcon,
  MousePointer2Icon,
  PentagonIcon,
  PlusIcon,
  RulerIcon,
  SplineIcon,
} from 'lucide-react'

/**
 * PDF plan + measurement overlay. The PDF page renders into a <canvas>; all
 * geometry lives in PDF POINT coordinates (pt) inside an SVG whose viewBox is
 * the page's pt size — so zoom never touches stored geometry, and calibration
 * (metres-per-pt) turns pt geometry into real quantities (src/lib/takeoff.ts).
 */

export interface CanvasItem {
  id: string
  shape: 'area' | 'line' | 'count'
  geometry: Pt[]
  color: string | null
  deduction: boolean
  description: string
  qty: number
  unit: string
}

type Tool = 'select' | 'calibrate' | 'area' | 'line' | 'count'

export const SHAPE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#be185d',
]

const TOOLS: { key: Tool; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'select', label: 'Select', icon: MousePointer2Icon },
  { key: 'calibrate', label: 'Calibrate', icon: RulerIcon },
  { key: 'area', label: 'Area', icon: PentagonIcon },
  { key: 'line', label: 'Length', icon: SplineIcon },
  { key: 'count', label: 'Count', icon: HashIcon },
]

function centroid(points: Pt[]): Pt {
  const n = points.length || 1
  return [
    points.reduce((s, p) => s + p[0], 0) / n,
    points.reduce((s, p) => s + p[1], 0) / n,
  ]
}

export function TakeoffCanvas({
  pdfUrl,
  page,
  scaleMPerPt,
  items,
  deduction,
  onCalibrated,
  onShapeComplete,
}: {
  pdfUrl: string
  page: number
  scaleMPerPt: number | null
  items: CanvasItem[]
  /** Next drawn area/line is a deduction (negative). */
  deduction: boolean
  onCalibrated: (mPerPt: number) => void
  onShapeComplete: (
    shape: 'area' | 'line' | 'count',
    geometry: Pt[],
    qty: number,
    unit: string
  ) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>(scaleMPerPt ? 'area' : 'calibrate')
  const [draft, setDraft] = useState<Pt[]>([])
  const [cursor, setCursor] = useState<Pt | null>(null)
  // Calibration: two captured points → ask for the real distance.
  const [calibrationPts, setCalibrationPts] = useState<Pt[]>([])
  const [calibrationMetres, setCalibrationMetres] = useState('')

  // ── Render the PDF page ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()
        const doc = await pdfjs.getDocument({ url: pdfUrl }).promise
        if (cancelled) return
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages))
        if (cancelled) return
        const dpr = window.devicePixelRatio || 1
        const viewport = pdfPage.getViewport({ scale: zoom * dpr })
        const base = pdfPage.getViewport({ scale: 1 })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${base.width * zoom}px`
        canvas.style.height = `${base.height * zoom}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise
        if (!cancelled) {
          setPageSize({ w: base.width, h: base.height })
          setRenderError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(
            err instanceof Error ? err.message : 'Could not render the PDF'
          )
        }
      }
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [pdfUrl, page, zoom])

  // ── Coordinate mapping: client px → PDF pt ─────────────────────────────────
  const toPt = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): Pt => {
      const rect = e.currentTarget.getBoundingClientRect()
      return [
        Math.round(((e.clientX - rect.left) / zoom) * 100) / 100,
        Math.round(((e.clientY - rect.top) / zoom) * 100) / 100,
      ]
    },
    [zoom]
  )

  const finishDraft = useCallback(() => {
    if (tool === 'area' && draft.length >= 3) {
      const qty = scaleMPerPt ? areaM2(draft, scaleMPerPt) : polygonAreaPt2(draft)
      onShapeComplete('area', draft, qty, 'm2')
    } else if (tool === 'line' && draft.length >= 2) {
      const qty = scaleMPerPt ? lengthM(draft, scaleMPerPt) : polylineLengthPt(draft)
      onShapeComplete('line', draft, qty, 'm')
    } else if (tool === 'count' && draft.length >= 1) {
      onShapeComplete('count', draft, draft.length, 'ea')
    }
    setDraft([])
  }, [tool, draft, scaleMPerPt, onShapeComplete])

  // Enter finishes, Escape cancels the in-progress shape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDraft([])
        setCalibrationPts([])
      } else if (e.key === 'Enter' && draft.length > 0) {
        e.preventDefault()
        finishDraft()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, finishDraft])

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const pt = toPt(e)
    if (tool === 'calibrate') {
      setCalibrationPts((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]))
      return
    }
    if (tool === 'area' || tool === 'line' || tool === 'count') {
      setDraft((prev) => [...prev, pt])
    }
  }

  function handleCalibrationSubmit(e: React.FormEvent) {
    e.preventDefault()
    const metres = parseFloat(calibrationMetres)
    if (!Number.isFinite(metres) || metres <= 0 || calibrationPts.length !== 2) return
    const scale = scaleFromCalibration(calibrationPts[0], calibrationPts[1], metres)
    if (scale > 0) {
      onCalibrated(scale)
      setCalibrationPts([])
      setCalibrationMetres('')
      setTool('area')
    }
  }

  // Live readout for the in-progress shape.
  const draftQty =
    draft.length === 0
      ? null
      : tool === 'area' && draft.length >= 3
        ? scaleMPerPt
          ? `${areaM2(draft, scaleMPerPt)} m²`
          : `${Math.round(polygonAreaPt2(draft))} pt²`
        : tool === 'line' && draft.length >= 2
          ? scaleMPerPt
            ? `${lengthM(draft, scaleMPerPt)} m`
            : `${Math.round(polylineLengthPt(draft))} pt`
          : tool === 'count'
            ? `${draft.length} ea`
            : null

  const measuringBlocked = !scaleMPerPt && (tool === 'area' || tool === 'line')

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map((t) => {
          const Icon = t.icon
          return (
            <Button
              key={t.key}
              size="sm"
              variant={tool === t.key ? 'default' : 'outline'}
              onClick={() => {
                setTool(t.key)
                setDraft([])
                setCalibrationPts([])
              }}
            >
              <Icon className="size-4" />
              {t.label}
            </Button>
          )
        })}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="icon-sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>
          <MinusIcon className="size-4" />
          <span className="sr-only">Zoom out</span>
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button size="icon-sm" variant="outline" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}>
          <PlusIcon className="size-4" />
          <span className="sr-only">Zoom in</span>
        </Button>
        {draft.length > 0 && (
          <span className="ml-2 rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
            {draftQty ?? '…'} — Enter to finish, Esc to cancel
          </span>
        )}
      </div>

      {/* Calibration state */}
      {tool === 'calibrate' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <CrosshairIcon className="size-4 shrink-0" />
          {calibrationPts.length < 2 ? (
            <span>
              Click both ends of a known dimension on the drawing (
              {calibrationPts.length}/2)
            </span>
          ) : (
            <form onSubmit={handleCalibrationSubmit} className="flex items-center gap-2">
              <span>That distance is</span>
              <Input
                autoFocus
                value={calibrationMetres}
                onChange={(e) => setCalibrationMetres(e.target.value)}
                placeholder="5.4"
                className="h-8 w-24"
                inputMode="decimal"
              />
              <span>metres</span>
              <Button type="submit" size="sm">
                Set scale
              </Button>
            </form>
          )}
        </div>
      )}
      {measuringBlocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Calibrate the sheet first — areas and lengths need a scale. Counts
          work without one.
        </div>
      )}

      {/* Canvas + overlay */}
      <div className="relative max-h-[70vh] overflow-auto rounded-xl border bg-muted/30">
        {renderError ? (
          <p className="p-8 text-center text-sm text-destructive">{renderError}</p>
        ) : (
          <div className="relative w-fit">
            <canvas ref={canvasRef} className="block" />
            {pageSize && (
              <svg
                viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: pageSize.w * zoom,
                  height: pageSize.h * zoom,
                  cursor: tool === 'select' ? 'default' : 'crosshair',
                }}
                onClick={handleClick}
                onMouseMove={(e) => setCursor(toPt(e))}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  finishDraft()
                }}
              >
                {/* Saved shapes */}
                {items.map((item) => {
                  const color = item.color ?? SHAPE_COLORS[0]
                  const label = `${item.description} — ${item.qty}${item.unit === 'm2' ? ' m²' : ` ${item.unit}`}`
                  if (item.shape === 'area' && item.geometry.length >= 3) {
                    const [cx, cy] = centroid(item.geometry)
                    return (
                      <g key={item.id}>
                        <polygon
                          points={item.geometry.map((p) => p.join(',')).join(' ')}
                          fill={item.deduction ? '#dc2626' : color}
                          fillOpacity={0.22}
                          stroke={item.deduction ? '#dc2626' : color}
                          strokeWidth={1.5}
                          strokeDasharray={item.deduction ? '6 4' : undefined}
                        />
                        <text x={cx} y={cy} fontSize={11} fill={item.deduction ? '#dc2626' : color} textAnchor="middle" fontWeight={700}>
                          {label}
                        </text>
                      </g>
                    )
                  }
                  if (item.shape === 'line' && item.geometry.length >= 2) {
                    const mid = item.geometry[Math.floor(item.geometry.length / 2)]
                    return (
                      <g key={item.id}>
                        <polyline
                          points={item.geometry.map((p) => p.join(',')).join(' ')}
                          fill="none"
                          stroke={item.deduction ? '#dc2626' : color}
                          strokeWidth={2.5}
                          strokeDasharray={item.deduction ? '6 4' : undefined}
                        />
                        <text x={mid[0]} y={mid[1] - 5} fontSize={11} fill={color} textAnchor="middle" fontWeight={700}>
                          {label}
                        </text>
                      </g>
                    )
                  }
                  if (item.shape === 'count') {
                    return (
                      <g key={item.id}>
                        {item.geometry.map((p, i) => (
                          <g key={i}>
                            <circle cx={p[0]} cy={p[1]} r={7} fill={color} fillOpacity={0.85} />
                            <text x={p[0]} y={p[1] + 3.5} fontSize={9} fill="#fff" textAnchor="middle" fontWeight={700}>
                              {i + 1}
                            </text>
                          </g>
                        ))}
                        {item.geometry[0] && (
                          <text x={item.geometry[0][0] + 12} y={item.geometry[0][1] - 8} fontSize={11} fill={color} fontWeight={700}>
                            {label}
                          </text>
                        )}
                      </g>
                    )
                  }
                  return null
                })}

                {/* Draft shape */}
                {draft.length > 0 && (
                  <g>
                    {tool === 'area' && draft.length >= 2 && (
                      <polygon
                        points={[...draft, ...(cursor ? [cursor] : [])]
                          .map((p) => p.join(','))
                          .join(' ')}
                        fill={deduction ? '#dc2626' : '#2563eb'}
                        fillOpacity={0.15}
                        stroke={deduction ? '#dc2626' : '#2563eb'}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                    )}
                    {tool === 'line' && (
                      <polyline
                        points={[...draft, ...(cursor ? [cursor] : [])]
                          .map((p) => p.join(','))
                          .join(' ')}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    )}
                    {draft.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#2563eb" />
                    ))}
                  </g>
                )}

                {/* Calibration points */}
                {calibrationPts.map((p, i) => (
                  <g key={`cal-${i}`}>
                    <circle cx={p[0]} cy={p[1]} r={5} fill="#0891b2" />
                  </g>
                ))}
                {calibrationPts.length === 2 && (
                  <line
                    x1={calibrationPts[0][0]}
                    y1={calibrationPts[0][1]}
                    x2={calibrationPts[1][0]}
                    y2={calibrationPts[1][1]}
                    stroke="#0891b2"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                  />
                )}
              </svg>
            )}
          </div>
        )}
      </div>

      <p className={cn('text-xs text-muted-foreground', !scaleMPerPt && 'text-amber-700 dark:text-amber-400')}>
        {scaleMPerPt
          ? `Calibrated: 1pt = ${(scaleMPerPt * 1000).toFixed(2)}mm · click to add points, Enter/double-click to finish`
          : 'Not calibrated yet — use the Calibrate tool on a known dimension.'}
      </p>
    </div>
  )
}
