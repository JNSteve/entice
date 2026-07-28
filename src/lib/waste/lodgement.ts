// Lodgement timing for regulated waste movements.
//
// "Generator must give the information to the department within 7 days"
// (Environmental Protection Regulation 2019, Schedule 12). The clock starts at
// COLLECTION — that is when the generator's obligation arises — not at
// disposal, which is what selects the monthly file (spec §2.4).
//
// Pure functions; the caller supplies the AU calendar day so client and server
// agree regardless of host clock.

export const LODGEMENT_WINDOW_DAYS = 7

export type LodgementUrgency = 'lodged' | 'overdue' | 'due-today' | 'soon' | 'ok'

export interface LodgementStatus {
  urgency: LodgementUrgency
  /** Days remaining; negative once overdue. Null when already lodged. */
  daysLeft: number | null
  label: string
}

/** Whole days between two 'YYYY-MM-DD' AU calendar days (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`)
  const db = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(da) || Number.isNaN(db)) return 0
  return Math.round((db - da) / 86_400_000)
}

export function lodgementStatus(
  collectionDate: string,
  lodgedAt: string | null,
  today: string
): LodgementStatus {
  if (lodgedAt) {
    return { urgency: 'lodged', daysLeft: null, label: 'Lodged' }
  }

  const elapsed = daysBetween(collectionDate, today)
  const daysLeft = LODGEMENT_WINDOW_DAYS - elapsed

  if (daysLeft < 0) {
    const over = Math.abs(daysLeft)
    return {
      urgency: 'overdue',
      daysLeft,
      label: `${over} day${over === 1 ? '' : 's'} overdue`,
    }
  }
  if (daysLeft === 0) return { urgency: 'due-today', daysLeft, label: 'Due today' }
  if (daysLeft <= 2) {
    return { urgency: 'soon', daysLeft, label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` }
  }
  return { urgency: 'ok', daysLeft, label: `${daysLeft} days left` }
}

/** Which of the three parts are still outstanding, for the register. */
export function outstandingParts(m: {
  part2_submitted_at: string | null
  part3_submitted_at: string | null
}): string[] {
  const missing: string[] = []
  if (!m.part2_submitted_at) missing.push('Transport')
  if (!m.part3_submitted_at) missing.push('Receipt')
  return missing
}

/** 'YYYY-MM' options for the month filter, newest first. */
export function monthOptions(today: string, count = 12): string[] {
  const [y, m] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const month = m - 1 - i
    const year = y + Math.floor(month / 12)
    const norm = ((month % 12) + 12) % 12
    out.push(`${year}-${String(norm + 1).padStart(2, '0')}`)
  }
  return out
}

/** '2026-07' → 'July 2026'. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${names[m - 1]} ${y}`
}
