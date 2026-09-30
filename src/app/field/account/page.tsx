import { requireRole } from '@/lib/auth'
import { ChangePasswordForm } from './change-password-form'

export default async function AccountPage() {
  const profile = await requireRole('admin', 'office', 'supervisor', 'field')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">My account</h1>
        <p className="text-sm text-muted-foreground">{profile.full_name}</p>
      </div>
      <ChangePasswordForm />
    </div>
  )
}
