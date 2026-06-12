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
      <div className="w-full max-w-sm text-left">
        <p className="text-3xl font-bold tracking-tight text-[#1e3a5f]">
          Entice
        </p>
        <p className="text-sm text-muted-foreground mt-1">
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
