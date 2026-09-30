'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

/** Any signed-in user changes their own password (e.g. replacing the temporary one an admin set). */
export async function changePassword(
  password: string,
  confirm: string
): Promise<{ error?: string }> {
  if (typeof password !== 'string' || password.length < 8) {
    return { error: 'Password must be at least 8 characters' }
  }
  if (password !== confirm) return { error: 'The two passwords don’t match' }

  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (/different from the old|same password/i.test(error.message)) {
      return { error: 'Choose a password different from your current one' }
    }
    if (/weak|pwned|leaked/i.test(error.message)) {
      return { error: 'That password is too common or has appeared in a data breach — pick another' }
    }
    return { error: error.message }
  }
  return {}
}
