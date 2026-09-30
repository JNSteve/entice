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
import { CopyIcon, PencilIcon, PlusIcon, UsersIcon } from 'lucide-react'

export interface ProfileRow {
  id: string
  full_name: string
  role: UserRole
  phone: string | null
  position: string | null
  hourly_cost: number | null
  active: boolean
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  office: 'Office',
  supervisor: 'Supervisor',
  field: 'Field',
}

export function UsersSection({
  profiles,
  currentUserId,
}: {
  profiles: ProfileRow[]
  currentUserId: string
}) {
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
            render: (r: ProfileRow) => {
              const isSelf = r.id === currentUserId
              return (
                <div className="flex items-center justify-end gap-1">
                  <EditUserDialog profile={r} isSelf={isSelf} />
                  {!isSelf && (
                    <ToggleActiveButton
                      active={r.active}
                      label={r.full_name}
                      onToggle={(active) => updateProfile(r.id, { active })}
                    />
                  )}
                </div>
              )
            },
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

const PW_WORDS = [
  'Tide', 'Rock', 'Dune', 'Reef', 'Gum', 'Hawk', 'Crane', 'Bolt', 'Slab', 'Kerb',
  'Pier', 'Mako', 'Ridge', 'Creek', 'Ute', 'Drill', 'Grout', 'Level', 'Steel', 'Clay',
]

/** Easy-to-read temporary password, e.g. "Reef-4827-Crane". */
function generatePassword(): string {
  const r = new Uint32Array(3)
  crypto.getRandomValues(r)
  const word = (n: number) => PW_WORDS[n % PW_WORDS.length]
  return `${word(r[0])}-${String(1000 + (r[1] % 9000))}-${word(r[2])}`
}

/** The message an admin texts to a new starter — login, install, change password. */
export function loginMessage(opts: {
  fullName: string
  email: string
  password: string
  origin: string
  role: UserRole
}): string {
  const first = opts.fullName.trim().split(/\s+/)[0] || opts.fullName
  const url = `${opts.origin}${opts.role === 'field' || opts.role === 'supervisor' ? '/field' : ''}`
  return [
    `Hi ${first}, here's your Entice login (timesheets, SWMS sign-on, site photos and forms).`,
    '',
    `1. On your phone open: ${url}`,
    `2. Sign in with ${opts.email}`,
    `   Temporary password: ${opts.password}`,
    '3. Add it to your home screen:',
    '   iPhone (Safari): Share → Add to Home Screen',
    '   Android (Chrome): ⋮ menu → Install app',
    '4. Change your password: tap the key icon at the top of the app.',
  ].join('\n')
}

function NewUserDialog() {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('field')
  const [phone, setPhone] = useState('')
  const [position, setPosition] = useState('')
  const [hourlyCost, setHourlyCost] = useState<number | null>(null)
  // After creating: the login details to hand over.
  const [created, setCreated] = useState<string | null>(null)

  function reset() {
    setFullName('')
    setEmail('')
    setPassword('')
    setRole('field')
    setPhone('')
    setPosition('')
    setHourlyCost(null)
    setCreated(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createUser({
        full_name: fullName,
        email,
        password,
        role,
        phone,
        position,
        hourly_cost: hourlyCost,
      })
      if (result.error && !result.id) {
        toast.error(result.error)
        return
      }
      if (result.error) toast.warning(result.error)
      else toast.success(`${fullName} can now sign in`)
      setCreated(
        loginMessage({ fullName, email, password, origin: window.location.origin, role })
      )
    })
  }

  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created)
      toast.success('Copied — paste it into a text message')
    } catch {
      toast.error('Couldn’t copy — select the text and copy it manually')
    }
  }

  const needsRate = (role === 'field' || role === 'supervisor') && hourlyCost == null

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New user
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{created ? 'Send them their login' : 'New user'}</DialogTitle>
          </DialogHeader>
          {created ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Text or email this to {fullName.split(' ')[0] || 'them'}. The temporary password
                isn&apos;t shown again.
              </p>
              <textarea
                readOnly
                value={created}
                rows={11}
                className="w-full rounded-lg border bg-muted/40 p-3 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Login details"
              />
              <DialogFooter>
                <Button variant="outline" onClick={reset}>
                  Add another
                </Button>
                <Button onClick={copy}>
                  <CopyIcon />
                  Copy message
                </Button>
              </DialogFooter>
            </div>
          ) : (
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
              <div className="grid grid-cols-2 gap-3">
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="nu-position">Position (optional)</Label>
                  <Input
                    id="nu-position"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="Labourer"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nu-email">Email (their login)</Label>
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
                <Label htmlFor="nu-phone">Mobile (optional)</Label>
                <Input
                  id="nu-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="04xx xxx xxx"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nu-password">Temporary password</Label>
                <div className="flex gap-2">
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
                  <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">They can change it from the key icon in the app.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Hourly cost (AUD)</Label>
                <MoneyInput value={hourlyCost} onChange={setHourlyCost} className="max-w-36" />
                <p className={needsRate ? 'text-xs text-amber-600' : 'text-xs text-muted-foreground'}>
                  {needsRate
                    ? 'Without a rate, their approved hours cost $0 on job P&Ls.'
                    : 'What an hour of their time costs you (wage + on-costs), ex GST.'}
                </p>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Creating…' : 'Create user'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Edit user dialog ─────────────────────────────────────────────────────────

function EditUserDialog({
  profile,
  isSelf,
}: {
  profile: ProfileRow
  isSelf: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [position, setPosition] = useState(profile.position ?? '')
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
        position,
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
              <Label htmlFor="eu-position">Position</Label>
              <Input
                id="eu-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Director"
              />
              <p className="text-xs text-muted-foreground">
                Printed as &quot;Prepared by&quot; on templated quotes.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as UserRole)}
                disabled={isSelf}
              >
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
              {isSelf && (
                <p className="text-xs text-muted-foreground">
                  You can&apos;t change your own role or active status.
                </p>
              )}
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
