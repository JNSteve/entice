import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Plain anon-key Supabase client with no cookie/session plumbing, for the
 * PUBLIC pages (/sign/[token]) and their server actions. Unauthenticated by
 * design — the only useful surface is the security-definer RPCs granted to
 * `anon` (get_shared_doc, submit_shared_signon, submit_subbie_swms); every
 * table read/write is blocked by RLS.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
