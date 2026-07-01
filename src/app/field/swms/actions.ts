'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { swmsSignSchema } from '@/lib/zod'

type Result = { error?: string }

const DATA_URL_PREFIX = 'data:image/png;base64,'
const MAX_SIGNATURE_BYTES = 200 * 1024 // ~200KB

/**
 * Records the current user's sign-on for a SWMS instance:
 * uploads the signature PNG to the attachments bucket at
 * swms/{instanceId}/{userId}-v{version}.png, then inserts a
 * swms_signatures row pinned to the instance's CURRENT version.
 */
export async function signSwms(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = swmsSignSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const { instance_id, name, signature, version: viewedVersion } = parsed.data

  let png: Buffer
  try {
    png = Buffer.from(signature.slice(DATA_URL_PREFIX.length), 'base64')
  } catch {
    return { error: 'Could not read the signature image' }
  }
  if (png.byteLength === 0) {
    return { error: 'Signature is empty — draw your signature first' }
  }
  if (png.byteLength > MAX_SIGNATURE_BYTES) {
    return { error: 'Signature image is too large (max 200KB)' }
  }

  const supabase = await createClient()

  const { data: instance } = await supabase
    .from('swms_instances')
    .select('id, project_id, job_id, version, status')
    .eq('id', instance_id)
    .single()
  if (!instance) return { error: 'SWMS not found' }
  if (instance.status !== 'active') {
    return { error: 'This SWMS has been superseded and can no longer be signed' }
  }

  const version = Number(instance.version)

  // Compare-and-set: the worker must be signing the exact version they read.
  // If revise() bumped the version between view and submit, reject — signing a
  // revision they never saw would be a false attestation.
  if (version !== viewedVersion) {
    return {
      error:
        'This SWMS was revised while you were reading it — please review the current version and sign again.',
    }
  }

  // Friendly duplicate check (the unique constraint is the backstop).
  const { data: existing } = await supabase
    .from('swms_signatures')
    .select('id')
    .eq('swms_instance_id', instance_id)
    .eq('user_id', profile.id)
    .eq('version', version)
    .maybeSingle()
  if (existing) return { error: 'You have already signed this version' }

  // Unique key per attempt: a deterministic key could collide with a stale
  // object left by an earlier upload-OK/insert-failed attempt, silently
  // keeping the FIRST drawing (signers cannot overwrite or delete under RLS).
  // A rare orphaned PNG from a failed attempt is the accepted trade-off.
  const path = `swms/${instance_id}/${profile.id}-v${version}-${crypto
    .randomUUID()
    .slice(0, 8)}.png`

  const { error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(path, png, { contentType: 'image/png' })
  if (uploadError) {
    return { error: uploadError.message }
  }

  const { error } = await supabase.from('swms_signatures').insert({
    swms_instance_id: instance_id,
    user_id: profile.id,
    name,
    signature_path: path,
    version,
  })
  if (error) {
    if (error.code === '23505') {
      return { error: 'You have already signed this version' }
    }
    return { error: error.message }
  }

  revalidatePath('/field/swms')
  revalidatePath(`/field/swms/${instance_id}`)
  if (instance.project_id) revalidatePath(`/projects/${instance.project_id}`)
  if (instance.job_id) revalidatePath(`/jobs/${instance.job_id}`)
  return {}
}
