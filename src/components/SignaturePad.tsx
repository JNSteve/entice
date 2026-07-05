'use client'

import React, { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 200

interface SignaturePadProps {
  /** Fires with a PNG data URL after each stroke, or null when cleared. */
  onChange: (dataUrl: string | null) => void
}

/**
 * Touch/stylus/mouse signature pad. Draws into a fixed-resolution canvas
 * (white background so the exported PNG reads on paper) and exports a PNG
 * data URL via onChange.
 */
export function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  function getCtx(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null
  }

  /** Maps a pointer event to canvas-internal coordinates. */
  function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    }
  }

  function ensureBackground(ctx: CanvasRenderingContext2D) {
    // Paint the white background lazily on first stroke so a cleared pad
    // still exports a readable PNG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = getCtx()
    if (!ctx) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Some pointer implementations can't capture — drawing still works.
    }
    if (!hasInk) ensureBackground(ctx)
    drawingRef.current = true
    const { x, y } = toCanvasPoint(e)
    ctx.strokeStyle = '#1c2434'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    // A dot for taps — looks like a pen touch.
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
    setHasInk(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = getCtx()
    if (!ctx) return
    const { x, y } = toCanvasPoint(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    drawingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may never have been taken — see handlePointerDown.
    }
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function handleClear() {
    const ctx = getCtx()
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    drawingRef.current = false
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="h-40 w-full touch-none rounded-xl border bg-white"
        aria-label="Signature pad — draw your signature"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {hasInk ? 'Signature captured.' : 'Sign in the box above.'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={!hasInk}
        >
          Clear
        </Button>
      </div>
    </div>
  )
}
