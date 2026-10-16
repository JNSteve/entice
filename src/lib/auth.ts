import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'office' | 'supervisor' | 'field'

export type Profile = {
  id: string
  full_name: string
  role: Role
  /** IMS-M-01 defined position, e.g. 'Director (Compliance and Technical)'. */
  position?: string | null
}

/** The position that maintains the IMS and alone closes corrective actions (SMS-05). */
export const COMPLIANCE_DIRECTOR = 'Director (Compliance and Technical)'

/** Directors by defined position — mirrors is_director() in migration 0072. */
export function isDirector(profile: Pick<Profile, 'position'> | null | undefined): boolean {
  return !!profile?.position?.startsWith('Director (')
}

/** Mirrors is_compliance_director() in migration 0072. */
export function isComplianceDirector(profile: Pick<Profile, 'position'> | null | undefined): boolean {
  return profile?.position === COMPLIANCE_DIRECTOR
}

/**
 * Returns the signed-in user's profile (session user + profiles row),
 * or null when there is no session.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, position')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  return profile as Profile
}

/**
 * Guards a page/layout by role.
 * - No session → redirect to /login.
 * - Signed in but role not allowed → redirect to /field.
 */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!roles.includes(profile.role)) redirect('/field')
  return profile
}
