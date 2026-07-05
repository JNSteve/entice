// Pure backup-pipeline logic for the daily off-DB backup (ISO 7.5.3.2 —
// records protected from loss). Used by the /api/cron/backup route, the
// Settings → Backups section and the dashboard staleness alert. Everything
// here is side-effect free so it stays unit-testable (tests/backup.test.ts).

const TZ = 'Australia/Brisbane'

/** Private storage bucket the pipeline writes to (created in 0027). */
export const BACKUP_BUCKET = 'backups'
/** Gzipped JSON exports live under this prefix: db/YYYY-MM-DD-HHmm.json.gz */
export const EXPORT_PREFIX = 'db'
/** Mirrored storage blobs live under storage/<bucket>/<original path>. */
export const MIRROR_PREFIX = 'storage'
/** Small standalone copy of the latest storage manifest, for cheap diffing. */
export const MANIFEST_KEY = 'manifest-latest.json'
/** Exports older than this many days are pruned by each run. */
export const RETENTION_DAYS = 35
/** Cap on storage bytes mirrored per run — the rest is skipped and logged. */
export const MIRROR_CAP_BYTES = 500 * 1024 * 1024
/** Dashboard alert threshold: latest successful run older than this is stale. */
export const STALE_AFTER_HOURS = 26

/**
 * Export object key for a run at the given instant, stamped with the
 * BRISBANE wall-clock (matches the manual `entice-backup-YYYYMMDD.json`
 * naming and the "3 am" the owner expects to see): db/2026-07-05-0300.json.gz
 */
export function backupExportKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  // Some environments render midnight as '24'; normalise (same guard as tz.ts).
  const hour = String(Number(get('hour')) % 24).padStart(2, '0')
  return `${EXPORT_PREFIX}/${get('year')}-${get('month')}-${get('day')}-${hour}${get('minute')}.json.gz`
}

/**
 * Staleness rule for the dashboard "Needs attention" row: no successful run
 * ever, an unparsable timestamp, or the latest success starting more than
 * STALE_AFTER_HOURS ago all count as stale.
 */
export function isBackupStale(
  latestSuccessStartedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!latestSuccessStartedAt) return true
  const t = Date.parse(latestSuccessStartedAt)
  if (Number.isNaN(t)) return true
  return now.getTime() - t > STALE_AFTER_HOURS * 60 * 60 * 1000
}

export type StorageManifestObject = {
  bucket: string
  name: string
  size: number
  updated_at: string | null
}

/** Destination key for a mirrored blob inside the backups bucket. */
export function mirrorKey(o: Pick<StorageManifestObject, 'bucket' | 'name'>): string {
  return `${MIRROR_PREFIX}/${o.bucket}/${o.name}`
}

/**
 * Objects in the current manifest that are NEW or CHANGED (size or
 * updated_at differs) versus the previous manifest — the incremental mirror
 * set. Objects deleted since the last run are left mirrored (a backup keeps
 * what production loses).
 */
export function manifestDiff(
  prev: StorageManifestObject[],
  curr: StorageManifestObject[]
): StorageManifestObject[] {
  const key = (o: StorageManifestObject) => `${o.bucket}/${o.name}`
  const prevByKey = new Map(prev.map((o) => [key(o), o]))
  return curr.filter((o) => {
    const p = prevByKey.get(key(o))
    return !p || p.size !== o.size || p.updated_at !== o.updated_at
  })
}

/**
 * Split the mirror set under the per-run byte cap, preserving order. An
 * object that would push the running total past the cap is skipped, but
 * smaller later objects may still fit.
 */
export function planMirror(
  diff: StorageManifestObject[],
  capBytes: number = MIRROR_CAP_BYTES
): { copy: StorageManifestObject[]; skipped: StorageManifestObject[] } {
  const copy: StorageManifestObject[] = []
  const skipped: StorageManifestObject[] = []
  let total = 0
  for (const o of diff) {
    if (total + o.size <= capBytes) {
      copy.push(o)
      total += o.size
    } else {
      skipped.push(o)
    }
  }
  return { copy, skipped }
}

/**
 * true when an export object NAME (as listed under db/, e.g.
 * '2026-05-01-0300.json.gz') is past the retention window, judged against
 * the Brisbane calendar day so the boundary matches the stamp in the name.
 * Names that don't match the export pattern are NEVER pruned.
 */
export function isExpiredExport(
  name: string,
  now: Date = new Date(),
  retentionDays: number = RETENTION_DAYS
): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})-\d{4}\.json\.gz$/.exec(name)
  if (!m) return false
  const fileDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
  const [y, mo, d] = todayStr.split('-').map(Number)
  const today = Date.UTC(y, mo - 1, d)
  return (today - fileDay) / 86_400_000 > retentionDays
}
