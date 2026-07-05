import { expect, test } from 'vitest'
import {
  MIRROR_CAP_BYTES,
  RETENTION_DAYS,
  STALE_AFTER_HOURS,
  backupExportKey,
  isBackupStale,
  isExpiredExport,
  manifestDiff,
  mirrorKey,
  planMirror,
  type StorageManifestObject,
} from '../src/lib/backup'

// ─── Export key naming (Brisbane wall-clock) ─────────────────────────────────

test('backupExportKey stamps the Brisbane wall-clock', () => {
  // 17:00 UTC = 03:00 next day in Brisbane (+10) — the cron schedule.
  expect(backupExportKey(new Date('2026-07-04T17:00:00Z'))).toBe(
    'db/2026-07-05-0300.json.gz'
  )
})

test('backupExportKey handles Brisbane midnight (the 24:00 edge)', () => {
  // 14:00 UTC = 00:00 next day in Brisbane.
  expect(backupExportKey(new Date('2026-07-04T14:00:00Z'))).toBe(
    'db/2026-07-05-0000.json.gz'
  )
})

test('backupExportKey pads single-digit hours and minutes', () => {
  // 23:05 UTC = 09:05 next day in Brisbane.
  expect(backupExportKey(new Date('2026-01-31T23:05:00Z'))).toBe(
    'db/2026-02-01-0905.json.gz'
  )
})

// ─── Staleness rule (dashboard needs-attention) ──────────────────────────────

const NOW = new Date('2026-07-05T12:00:00Z')

test('no successful backup ever → stale', () => {
  expect(isBackupStale(null, NOW)).toBe(true)
  expect(isBackupStale(undefined, NOW)).toBe(true)
})

test('unparsable timestamp → stale', () => {
  expect(isBackupStale('not-a-date', NOW)).toBe(true)
})

test('a run inside the window is fresh', () => {
  // 25 hours ago — inside the 26-hour allowance.
  expect(isBackupStale('2026-07-04T11:00:00Z', NOW)).toBe(false)
  // Exactly on the boundary is still fresh (strictly older-than trips it).
  expect(STALE_AFTER_HOURS).toBe(26)
  expect(isBackupStale('2026-07-04T10:00:00Z', NOW)).toBe(false)
})

test('a run older than 26 hours is stale', () => {
  expect(isBackupStale('2026-07-04T09:59:59Z', NOW)).toBe(true)
  expect(isBackupStale('2026-07-01T10:00:00Z', NOW)).toBe(true)
})

// ─── Manifest diff (incremental storage mirror) ──────────────────────────────

const obj = (
  bucket: string,
  name: string,
  size: number,
  updated_at: string | null = '2026-07-01T00:00:00Z'
): StorageManifestObject => ({ bucket, name, size, updated_at })

test('manifestDiff picks up new and changed objects only', () => {
  const prev = [
    obj('attachments', 'job/1/a.pdf', 100),
    obj('attachments', 'job/1/b.pdf', 200),
    obj('branding', 'logo.png', 50),
  ]
  const curr = [
    obj('attachments', 'job/1/a.pdf', 100), // unchanged
    obj('attachments', 'job/1/b.pdf', 250), // size changed
    obj('branding', 'logo.png', 50, '2026-07-02T00:00:00Z'), // touched
    obj('attachments', 'job/2/c.pdf', 300), // new
  ]
  const diff = manifestDiff(prev, curr)
  expect(diff.map((o) => o.name).sort()).toEqual([
    'job/1/b.pdf',
    'job/2/c.pdf',
    'logo.png',
  ])
})

test('manifestDiff with no previous manifest mirrors everything', () => {
  const curr = [obj('attachments', 'a', 1), obj('branding', 'b', 2)]
  expect(manifestDiff([], curr)).toHaveLength(2)
})

test('objects deleted from production are not in the mirror set', () => {
  const prev = [obj('attachments', 'gone.pdf', 10)]
  expect(manifestDiff(prev, [])).toHaveLength(0)
})

test('same name in different buckets are distinct objects', () => {
  const prev = [obj('attachments', 'logo.png', 10)]
  const curr = [obj('attachments', 'logo.png', 10), obj('branding', 'logo.png', 10)]
  const diff = manifestDiff(prev, curr)
  expect(diff).toHaveLength(1)
  expect(diff[0].bucket).toBe('branding')
})

test('mirrorKey namespaces by source bucket', () => {
  expect(mirrorKey(obj('attachments', 'job/1/a.pdf', 1))).toBe(
    'storage/attachments/job/1/a.pdf'
  )
  expect(mirrorKey(obj('branding', 'logo.png', 1))).toBe('storage/branding/logo.png')
})

// ─── Mirror cap (500 MB per run) ─────────────────────────────────────────────

test('planMirror splits at the byte cap, letting smaller later files fit', () => {
  const diff = [
    obj('attachments', 'big1', 60),
    obj('attachments', 'big2', 50), // 60+50 > 100 → skipped
    obj('attachments', 'small', 30), // 60+30 ≤ 100 → still fits
  ]
  const { copy, skipped } = planMirror(diff, 100)
  expect(copy.map((o) => o.name)).toEqual(['big1', 'small'])
  expect(skipped.map((o) => o.name)).toEqual(['big2'])
})

test('planMirror default cap is 500 MB', () => {
  expect(MIRROR_CAP_BYTES).toBe(500 * 1024 * 1024)
  const under = [obj('attachments', 'a', 499 * 1024 * 1024)]
  expect(planMirror(under).copy).toHaveLength(1)
})

// ─── Retention pruning (35 days) ─────────────────────────────────────────────

test('exports older than 35 days are expired', () => {
  expect(RETENTION_DAYS).toBe(35)
  // NOW is 2026-07-05 22:00 Brisbane → cutoff day 2026-05-31.
  expect(isExpiredExport('2026-05-30-0300.json.gz', NOW)).toBe(true)
  expect(isExpiredExport('2026-04-01-0300.json.gz', NOW)).toBe(true)
})

test('exports inside the window are kept (boundary is exactly 35 days)', () => {
  expect(isExpiredExport('2026-05-31-0300.json.gz', NOW)).toBe(false)
  expect(isExpiredExport('2026-07-05-0300.json.gz', NOW)).toBe(false)
})

test('non-export names are never pruned', () => {
  expect(isExpiredExport('manifest-latest.json', NOW)).toBe(false)
  expect(isExpiredExport('2026-05-30.json.gz', NOW)).toBe(false)
  expect(isExpiredExport('random.txt', NOW)).toBe(false)
})
