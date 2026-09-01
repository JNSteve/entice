# Agent API chunked upload — large files from a remote agent

**Date:** 2026-09-01 · **Owner decision:** build it (reports/clearance certs will arrive weekly).

## Problem

`storage_upload` caps at 3 MB decoded because Vercel limits a serverless request
body to ~4.5 MB and base64 inflates ~33%. Real ECR documents exceed that — the
MBBC asbestos survey alone is 12 MB — so a remote agent cannot file a clearance
certificate or survey into a job's Documents.

Workarounds don't hold: a Supabase signed upload URL requires the agent's network
to reach the storage host directly (walled off in at least one workspace), and the
browser/extension route needs tooling the owner doesn't want to depend on.

## Solution

Chunked upload **through the portal**, which works from any environment that can
reach the portal at all — the only network assumption already required for the
agent API to function.

Four new actions/tools:

| Action | Purpose |
| --- | --- |
| `storage_upload_begin` | declare destination (+ optional filing target); returns `upload_id` and `part_max_bytes` |
| `storage_upload_part` | send part N as base64 (≤3 MB decoded, same proven cap) |
| `storage_upload_finish` | reassemble server-side, write the object, optionally file it as an attachment |
| `storage_upload_abort` | discard an in-flight upload |

### Flow

`begin` records intent; each `part` is written to a **dedicated private
`agent-uploads` bucket** under `<upload_id>/<part_number>`; `finish` verifies the
parts are contiguous 1..N, downloads and concatenates them, uploads the assembled
object to the real destination, optionally inserts the `attachments` row, then
deletes the parts.

Parts live in their own bucket deliberately: `backup_storage_manifest()` only
mirrors `attachments`/`branding`, so transient parts never enter the backup set.
`agent-uploads` is also kept **out of `STORAGE_BUCKETS`**, so the ordinary
storage actions can't read or write the staging area.

### Filing against a job (the actual goal)

`finish` accepts `parent_type`/`parent_id`/`kind`/`caption`/`client_visible` and
writes the `attachments` row, which is what makes the file appear in a job's
Documents. `parent_type` is validated against the canonical list and the parent
row's existence is checked first — the same guarantee `recordAttachment` gives.

Because `attachments.ts` is `'use server'` (it may only export async functions),
the canonical `PARENT_TYPES`/`PARENT_TABLE`/`ATTACHMENT_KINDS` move to a new
`src/lib/attachment-parents.ts` that both it and the agent executor import.
Duplicating that list would drift — it has already grown in migrations 0032,
0051 and 0054.

### Integrity

`finish` takes an optional `sha256` of the whole file and refuses to publish on
mismatch. This matters more than usual here: a silently truncated clearance
certificate is a compliance artefact that looks fine until someone opens it.
Byte total and part count are also cross-checked.

### Limits

Part ≤3 MB decoded (unchanged, proven against the platform limit); total ≤100 MB;
uploads expire after 24 h and expired sessions are opportunistically swept on
`begin`. The agent route's `maxDuration` rises to 300 s (matching the backup
route) since reassembly downloads and re-uploads the whole file.

### Data model (migration 0059)

- `agent_uploads` — one row per session: destination, filing target, status
  (`open`/`completed`/`aborted`), `bytes_received`, `expires_at`, `key_id`.
- `agent_upload_parts` — `(upload_id, part_number)` PK plus size, so gaps and
  duplicates are detected rather than silently producing a corrupt file.

Both admin-readable, service-role writable, mirroring `agent_keys`.

### Testing

Unit: envelope validation, part/total caps, contiguity checking, sha256
mismatch. Live: upload a real multi-megabyte PDF in parts through production,
confirm the reassembled bytes hash-match the source, confirm it appears against
a job, then remove the test artefacts.

### Out of scope

Parallel part upload (parts are order-independent on the wire but sequential is
simpler to reason about), resumable/TUS, and a signed-URL fast path for agents
that *can* reach storage directly — offered later if it's ever worth it.
