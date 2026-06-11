import type { SupabaseClient } from '@supabase/supabase-js'
import type { SwmsHazard } from '@/lib/zod'

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
