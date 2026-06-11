'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { MoneyInput } from '@/components/MoneyInput'
import { aud } from '@/lib/format'
import { USER_ROLES, type UserRole } from '@/lib/zod'
import { createUser, updateProfile } from './actions'
import { PencilIcon, PlusIcon, UsersIcon } from 'lucide-react'

export interface ProfileRow {
  id: string
  full_name: string
  role: UserRole
  phone: string | null
  hourly_cost: number | null
  active: boolean
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  office: 'Office',
  supervisor: 'Supervisor',
  field: 'Field',
}

export function UsersSection({ profiles }: { profiles: ProfileRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Sign-in emails are managed in Supabase Auth; profiles hold name, role
          and cost details.
        </p>
        <NewUserDialog />
      </div>
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (r: ProfileRow) => (
              <span className="font-medium">{r.full_name}</span>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (r: ProfileRow) => (
              <Badge variant="secondary">{ROLE_LABELS[r.role] ?? r.role}</Badge>
            ),
          },
          {
            key: 'phone',
            header: 'Phone',
            render: (r: ProfileRow) => (
              <span className="text-muted-foreground">{r.phone ?? '—'}</span>
            ),
          },
          {
            key: 'hourly_cost',
            header: 'Hourly cost',
            className: 'text-right',
            render: (r: ProfileRow) => (
              <span className="block text-right tabular-nums">
                {r.hourly_cost != null ? aud(r.hourly_cost) : '—'}
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: ProfileRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: ProfileRow) => (
              <div className="flex items-center justify-end gap-1">
                <EditUserDialog profile={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={r.full_name}
                  onToggle={(active) => updateProfile(r.id, { active })}
                />
              </div>
            ),
          },
        ]}
        rows={profiles}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<UsersIcon className="size-8" />}
            title="No users yet"
            description="Create the first user to get started."
          />
        }
      />
    </div>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge
      variant="outline"
      className="border bg-green-50 font-medium text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300"
    >
      Active
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border bg-gray-100 font-medium text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400"
    >
      Inactive
    </Badge>
  )
}

export function ToggleActiveButton({
  active,
  label,
  onToggle,
}: {
  active: boolean
  label: string
  onToggle: (active: boolean) => Promise<{ error?: string }>
}) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await onToggle(!active)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(active ? `${label} deactivated` : `${label} reactivated`)
    })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      className={active ? 'text-destructive hover:text-destructive' : undefined}
    >
      {pending ? '…' : active ? 'Deactivate' : 'Activate'}
    </Button>
  )
}

// ─── New user dialog ──────────────────────────────────────────────────────────

function NewUserDialog() {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('field')

  function reset() {
    setFullName('')
    setEmail('')
    setPassword('')
    setRole('field')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createUser({
        full_name: fullName,
        email,
        password,
        role,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`User created — share the temporary password with ${fullName}`)
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nu-name">Full name</Label>
              <Input
                id="nu-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nu-email">Email</Label>
              <Input
                id="nu-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nu-password">Temporary password</Label>
              <Input
                id="nu-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="Minimum 8 characters"
                autoComplete="off"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nu-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="nu-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Edit user dialog ─────────────────────────────────────────────────────────

function EditUserDialog({ profile }: { profile: ProfileRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [role, setRole] = useState<UserRole>(profile.role)
  const [hourlyCost, setHourlyCost] = useState<number | null>(
    profile.hourly_cost
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateProfile(profile.id, {
        full_name: fullName,
        phone,
        role,
        hourly_cost: hourlyCost,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('User updated')
      setOpen(false)
    })
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
        <PencilIcon />
        <span className="sr-only">Edit user</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-name">Full name</Label>
              <Input
                id="eu-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-phone">Phone</Label>
              <Input
                id="eu-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0400 000 000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="eu-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-hourly">Hourly cost (AUD)</Label>
              <MoneyInput
                value={hourlyCost}
                onChange={setHourlyCost}
                className="max-w-36"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
