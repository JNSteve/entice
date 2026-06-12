import { subDays, format } from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { AuditTable, ENTITY_TYPE_LABELS } from './audit-table'
import type { AuditFilters } from './audit-table'
import type { AuditRow } from '@/lib/audit-queries'

const PAGE_SIZE = 50
const EXPORT_CAP = 5000

const SELECT =
  'id, at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail'

export default async function WhsAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string
    to?: string
    project_id?: string
    entity_type?: string
    actor?: string
    action?: string
    page?: string
  }>
}) {
  await requireRole('admin', 'office', 'supervisor')

  const sp = await searchParams

  // Defaults: last 30 days
  const defaultFrom = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const defaultTo = format(new Date(), 'yyyy-MM-dd')

  const from = sp.from || defaultFrom
  const to = sp.to || defaultTo
  const projectId = sp.project_id || ''
  const entityType = sp.entity_type || ''
  const actor = sp.actor || ''
  const action = sp.action || ''
  const page = Math.max(1, parseInt(sp.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()

  // Build base queries and apply filters manually (avoid generic helper to
  // keep TypeScript happy with the varying return types).
  function buildQuery(withCount: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = withCount
      ? supabase.from('audit_log').select(SELECT, { count: 'exact' })
      : supabase.from('audit_log').select(SELECT)

    q = q.gte('at', from + 'T00:00:00').lte('at', to + 'T23:59:59')
    if (projectId) q = q.eq('project_id', projectId)
    if (entityType && ENTITY_TYPE_LABELS[entityType]) q = q.eq('entity_type', entityType)
    if (actor === '_external') {
      q = q.like('actor_name', 'External — %')
    } else if (actor) {
      q = q.eq('actor_name', actor)
    }
    if (action === 'external') {
      q = q.like('action', 'external_%')
    } else if (action && ['insert', 'update', 'delete'].includes(action)) {
      q = q.eq('action', action)
    }
    return q
  }

  const [{ data: rows, count }, { data: exportRows }] = await Promise.all([
    buildQuery(true)
      .order('at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1),
    buildQuery(false)
      .order('at', { ascending: false })
      .limit(EXPORT_CAP),
  ])

  const total = (count as number | null) ?? 0
  const capped = total > EXPORT_CAP

  // ─── Sidebar data: distinct actors + projects ─────────────────────────

  const [{ data: actorRows }, { data: projects }] = await Promise.all([
    supabase
      .from('audit_log')
      .select('actor_name')
      .not('actor_name', 'is', null)
      .not('actor_name', 'like', 'External — %')
      .order('actor_name'),
    supabase
      .from('projects')
      .select('id, number, name')
      .order('number'),
  ])

  // Distinct non-external actor names
  const actorNames = [
    ...new Set(
      ((actorRows ?? []) as { actor_name: string | null }[])
        .map((r) => r.actor_name ?? '')
        .filter(Boolean)
    ),
  ].sort()

  // Shape rows
  function shapeRow(r: Record<string, unknown>): AuditRow {
    return {
      id: r.id as string,
      at: r.at as string,
      actor_id: (r.actor_id as string | null) ?? null,
      actor_name: (r.actor_name as string | null) ?? null,
      entity_type: r.entity_type as string,
      entity_id: r.entity_id as string,
      project_id: (r.project_id as string | null) ?? null,
      action: r.action as string,
      detail: (r.detail ?? {}) as Record<string, unknown>,
    }
  }

  const auditRows: AuditRow[] = ((rows ?? []) as Record<string, unknown>[]).map(shapeRow)
  const auditExport: AuditRow[] = ((exportRows ?? []) as Record<string, unknown>[]).map(shapeRow)

  const filters: AuditFilters = {
    from,
    to,
    project_id: projectId,
    entity_type: entityType,
    actor,
    action,
    page,
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="WHS audit register"
        description="Immutable trail of all WHS events. Filters default to the last 30 days."
      />
      <AuditTable
        rows={auditRows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        projects={((projects ?? []) as { id: string; number: string; name: string }[]).map((p) => ({
          id: p.id,
          number: p.number,
          name: p.name,
        }))}
        actors={actorNames}
        filters={filters}
        exportRows={auditExport}
        capped={capped}
      />
    </div>
  )
}
