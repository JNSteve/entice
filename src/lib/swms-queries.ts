import type { SupabaseClient } from '@supabase/supabase-js'
import type { SwmsHazard } from '@/lib/zod'

// ─── Field worker SWMS list ──────────────────────────────────────────────────

export type SwmsSignState = 'signed' | 'resign' | 'needs'

export interface FieldSwmsItem {
  id: string
  title: string
  version: number
  parentLabel: string
  state: SwmsSignState
  /** True when the instance targets a project/job I'm assigned to this week. */
  assigned: boolean
}

function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * All ACTIVE SWMS instances with the signed-in user's sign state, flagging
 * the ones on projects/jobs the user is assigned to this week (Mon–Sun,
 * server local — acceptable v1). Shared by the field SWMS list and the
 * Safety home. Use in Server Components / server-side helpers only.
 */
export async function fetchMyFieldSwms(
  supabase: SupabaseClient,
  profileId: string
): Promise<FieldSwmsItem[]> {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - daysFromMonday)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  const [{ data: assignments }, { data: instances }] = await Promise.all([
    supabase
      .from('assignments')
      .select('project_id, job_id')
      .eq('user_id', profileId)
      .gte('date', localDateStr(weekStart))
      .lte('date', localDateStr(weekEnd)),
    supabase
      .from('swms_instances')
      .select(
        'id, title, version, status, project_id, job_id, created_at, projects(number, name), jobs(number, title)'
      )
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ])

  const mySignatures = (instances ?? []).length
    ? (
        await supabase
          .from('swms_signatures')
          .select('swms_instance_id, version')
          .eq('user_id', profileId)
          .in(
            'swms_instance_id',
            (instances ?? []).map((i) => i.id as string)
          )
      ).data
    : []

  // Highest version I've signed per instance.
  const signedVersion = new Map<string, number>()
  for (const sig of mySignatures ?? []) {
    const key = sig.swms_instance_id as string
    const v = Number(sig.version)
    if ((signedVersion.get(key) ?? 0) < v) signedVersion.set(key, v)
  }

  const assignedProjects = new Set(
    (assignments ?? []).map((a) => a.project_id as string | null).filter(Boolean)
  )
  const assignedJobs = new Set(
    (assignments ?? []).map((a) => a.job_id as string | null).filter(Boolean)
  )

  return (instances ?? []).map((i) => {
    const projectRel = i.projects as unknown as {
      number: string
      name: string
    } | null
    const jobRel = i.jobs as unknown as { number: string; title: string } | null
    const parentLabel = projectRel
      ? `${projectRel.number} — ${projectRel.name}`
      : jobRel
        ? `${jobRel.number} — ${jobRel.title}`
        : '—'

    const myVersion = signedVersion.get(i.id as string) ?? 0
    const state: SwmsSignState =
      myVersion >= Number(i.version)
        ? 'signed'
        : myVersion > 0
          ? 'resign'
          : 'needs'

    return {
      id: i.id as string,
      title: i.title as string,
      version: Number(i.version),
      parentLabel,
      state,
      assigned:
        (i.project_id != null && assignedProjects.has(i.project_id as string)) ||
        (i.job_id != null && assignedJobs.has(i.job_id as string)),
    }
  })
}

export interface SwmsRegisterRow {
  user_id: string
  name: string
  role: 'supervisor' | 'field'
  /** Signed-at timestamp for the CURRENT instance version, or null = outstanding. */
  signed_at: string | null
}

export interface SwmsInstanceListRow {
  id: string
  title: string
  hazardCount: number
  version: number
  status: 'active' | 'superseded'
  created_at: string
  signedCount: number
  registerTotal: number
  register: SwmsRegisterRow[]
}

/**
 * Fetches SWMS instances for a project or job, with the sign-on register:
 * every ACTIVE field/supervisor profile vs their signature for the instance's
 * CURRENT version (older-version signatures are stale → outstanding).
 * Use in Server Components / server-side helpers only.
 */
export async function fetchSwmsInstances(
  supabase: SupabaseClient,
  parentType: 'project' | 'job',
  parentId: string
): Promise<SwmsInstanceListRow[]> {
  const column = parentType === 'project' ? 'project_id' : 'job_id'

  const [{ data: instances }, { data: crew }] = await Promise.all([
    supabase
      .from('swms_instances')
      .select('id, title, hazards, version, status, created_at')
      .eq(column, parentId)
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['supervisor', 'field'])
      .eq('active', true)
      .order('full_name'),
  ])

  if (!instances || instances.length === 0) return []

  const { data: signatures } = await supabase
    .from('swms_signatures')
    .select('swms_instance_id, user_id, version, signed_at')
    .in(
      'swms_instance_id',
      instances.map((i) => i.id as string)
    )

  return instances.map((instance) => {
    const currentSigs = (signatures ?? []).filter(
      (s) =>
        s.swms_instance_id === instance.id &&
        Number(s.version) === Number(instance.version)
    )
    const signedAtByUser = new Map(
      currentSigs.map((s) => [s.user_id as string, s.signed_at as string])
    )

    const register: SwmsRegisterRow[] = (crew ?? []).map((p) => ({
      user_id: p.id as string,
      name: p.full_name as string,
      role: p.role as 'supervisor' | 'field',
      signed_at: signedAtByUser.get(p.id as string) ?? null,
    }))

    return {
      id: instance.id as string,
      title: instance.title as string,
      hazardCount: ((instance.hazards as SwmsHazard[] | null) ?? []).length,
      version: Number(instance.version),
      status: instance.status as 'active' | 'superseded',
      created_at: instance.created_at as string,
      signedCount: register.filter((r) => r.signed_at !== null).length,
      registerTotal: register.length,
      register,
    }
  })
}
