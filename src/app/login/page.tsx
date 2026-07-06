'use client'

import { useActionState } from 'react'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn } from './actions'

type SignInState = { error: string } | null

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    async (_prev, formData) => (await signIn(formData)) ?? null,
    null
  )

  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-muted/40 p-4 gap-6">
      {/* Branded navy panel with the ECR logo (navy background sits seamlessly). */}
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl bg-primary px-6 py-7 text-center shadow-sm ring-1 ring-primary/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://zspauxavbhtutanhekuu.supabase.co/storage/v1/object/public/branding/logo.png"
          alt="Entice"
          className="h-14 w-auto max-w-[240px] object-contain"
        />
        <p className="text-sm text-primary-foreground/70">
          Civil &amp; remediation operations
        </p>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-lg font-semibold">
            Sign in to your account
          </CardTitle>
          <CardDescription>Enter your email and password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            {state?.error && (
              <Alert variant="destructive">
                <AlertTitle>{state.error}</AlertTitle>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
