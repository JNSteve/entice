'use client'

import React, { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { CheckCircle2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignaturePad } from '@/components/SignaturePad'
import { MAX_SIGNATURE_CHARS } from '@/lib/form-validate'
import { submitSharedSignon } from './actions'

/**
 * Sign block for the public /sign/[token] page: name + company + signature
 * pad → submit_shared_signon RPC → success screen.
 */
export function SignClient({ token }: { token: string }) {
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [done, setDone] = useState<{ name: string; signedAt: string } | null>(null)

  function guardSignature(dataUrl: string | null): string | null {
    if (dataUrl && dataUrl.length > MAX_SIGNATURE_CHARS) {
      toast.error('Signature image is too large — clear and try again')
      return null
    }
    return dataUrl
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !company.trim()) {
      toast.error('Enter your name and company')
      return
    }
    if (!signature) {
      toast.error('Draw your signature first')
      return
    }
    startTransition(async () => {
      const result = await submitSharedSignon({
        token,
        name: name.trim(),
        company: company.trim(),
        signature,
      })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      if ('signedAt' in result) {
        setDone({ name: name.trim(), signedAt: result.signedAt })
      }
    })
  }

  if (done) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-6 py-10 text-center">
        <CheckCircle2Icon className="size-10 text-green-600 dark:text-green-400" />
        <h2 className="text-lg font-bold">
          Thanks {done.name}, you&apos;re signed on
        </h2>
        <p className="text-sm text-muted-foreground">
          {format(new Date(done.signedAt), 'dd/MM/yyyy HH:mm')}
        </p>
        <p className="text-sm text-muted-foreground">
          You can close this page now.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Sign on
      </h2>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-xl border p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-name">Name</Label>
          <Input
            id="sign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-company">Company</Label>
          <Input
            id="sign-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete="organization"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Signature</Label>
          <SignaturePad onChange={(d) => setSignature(guardSignature(d))} />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={pending || !signature || !name.trim() || !company.trim()}
        >
          {pending ? 'Signing…' : 'Sign on'}
        </Button>
      </form>
    </section>
  )
}
