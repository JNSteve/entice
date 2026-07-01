'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignaturePad } from '@/components/SignaturePad'
import { signSwms } from '../actions'

interface SignFormProps {
  instanceId: string
  /** The version rendered on this page — pinned into the signature so a revise()
   * between view and sign is caught server-side (compare-and-set). */
  version: number
  defaultName: string
}

export function SignForm({ instanceId, version, defaultName }: SignFormProps) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(defaultName)
  const [signature, setSignature] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!signature) {
      toast.error('Draw your signature first')
      return
    }
    startTransition(async () => {
      const result = await signSwms({
        instance_id: instanceId,
        name,
        version,
        signature,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Signed on — stay safe out there')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        I have read and understood this SWMS and will follow the controls listed
        above.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-name">Name</Label>
        <Input
          id="sign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Signature</Label>
        <SignaturePad onChange={setSignature} />
      </div>
      <Button type="submit" disabled={pending || !signature} size="lg">
        {pending ? 'Signing…' : 'Sign on'}
      </Button>
    </form>
  )
}
