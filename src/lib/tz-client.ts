// Client-safe Australian (Brisbane) calendar-date helper.
//
// Client components must derive 'today' from the AU calendar — not the
// browser's local clock — so overdue/expiry maths agrees with the server-side
// registers, which use src/lib/tz.ts (todayAU). This mirror lives in its own
// file so it can be imported from 'use client' modules without touching the
// server tz helpers. Brisbane = AEST (UTC+10), no daylight saving.

/** 'YYYY-MM-DD' for the current instant in Australian (Brisbane) time. */
export function todayAUClient(): string {
  // en-CA formats as YYYY-MM-DD — same technique as todayAU in src/lib/tz.ts.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
  }).format(new Date())
}

// Brisbane wall-clock as a 'YYYY-MM-DDTHH:mm' string for the given instant.
// This is the value a <input type="datetime-local"> expects. Pairing it with
// auLocalToInstant (src/lib/tz.ts) — which reads datetime-local values as
// Brisbane wall-clock — makes create/edit round-trip correctly on a UTC host.
function auInput(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  // hour can come back as '24' at midnight in some environments; normalise.
  const hour = String(Number(get('hour')) % 24).padStart(2, '0')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

/**
 * Current Brisbane wall-clock as 'YYYY-MM-DDTHH:mm', for defaulting a
 * datetime-local input. Never default such an input from
 * `new Date().toISOString().slice(0,16)` (UTC) or the browser's local getters:
 * the value is later read as Brisbane wall-clock, so a non-Brisbane source
 * double-shifts.
 */
export function nowAUInput(): string {
  return auInput(new Date())
}

/**
 * Given a stored UTC ISO instant, return its Brisbane wall-clock as
 * 'YYYY-MM-DDTHH:mm' — for pre-filling a datetime-local input when editing an
 * existing record, and for display prefills. Inverse of auLocalToInstant.
 */
export function instantToAUInput(iso: string): string {
  return auInput(new Date(iso))
}
