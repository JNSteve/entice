import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Creates a signed URL for a storage object.
 * NOTE: This is NOT a server action — import from anywhere.
 */
export async function signedUrl(
  supabase: SupabaseClient,
  path: string,
  expires = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, expires)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
