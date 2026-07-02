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
