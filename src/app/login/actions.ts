'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSafeNextPath } from '@/lib/agent-oauth'

export async function signIn(
  formData: FormData
): Promise<{ error: string } | undefined> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  // Optional return target (the OAuth consent screen sends one). Restricted to
  // same-origin relative paths so this can never become an open redirect.
  const next = String(formData.get('next') ?? '')

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) {
    return { error: error.message }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  if (next && isSafeNextPath(next)) redirect(next)
  redirect(profile?.role === 'field' ? '/field' : '/')
}
