'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignaturePad } from '@/components/SignaturePad'
import { MAX_SIGNATURE_CHARS } from '@/lib/form-validate'
import { addFormSignon } from '../../actions'

interface SignonSectionProps {
  submissionId: string
  defaultName: string
  alreadySignedSelf: boolean
  /** Pass-the-phone capture — RLS limits it to admin/office/supervisor. */
  canRecordOthers: boolean
}

export function SignonSection({
  submissionId,
  defaultName,
  alreadySignedSelf,
  canRecordOthers,
}: SignonSectionProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Self sign-on
  const [myName, setMyName] = useState(defaultName)
  const [mySignature, setMySignature] = useState<string | null>(null)
  const [myPadKey, setMyPadKey] = useState(0)

  // Pass-the-phone sign-on
  const [showOthers, setShowOthers] = useState(false)
  const [otherName, setOtherName] = useState('')
  const [otherCompany, setOtherCompany] = useState('')
  const [otherSignature, setOtherSignature] = useState<string | null>(null)
  const [otherPadKey, setOtherPadKey] = useState(0)

  function guardSignature(dataUrl: string | null): string | null {
    if (dataUrl && dataUrl.length > MAX_SIGNATURE_CHARS) {
      toast.error('Signature image is too large — clear and try again')
      return null
    }
    return dataUrl
  }

  function submitSelf() {
    if (!mySignature) {
      toast.error('Draw your signature first')
      return
    }
    startTransition(async () => {
      const result = await addFormSignon({
        submission_id: submissionId,
        name: myName,
        company: null,
        signature: mySignature,
        self: true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Signed on')
      setMySignature(null)
      setMyPadKey((k) => k + 1)
      router.refresh()
    })
  }

  function submitOther() {
    if (!otherName.trim()) {
      toast.error('Enter the person’s name')
      return
    }
    if (!otherSignature) {
      toast.error('Ask them to draw their signature first')
      return
    }
    startTransition(async () => {
      const result = await addFormSignon({
        submission_id: submissionId,
        name: otherName.trim(),
        company: otherCompany.trim() || null,
        signature: otherSignature,
        self: false,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${otherName.trim()} signed on — pass the phone to the next person`)
      setOtherName('')
      setOtherCompany('')
      setOtherSignature(null)
      setOtherPadKey((k) => k + 1)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {!alreadySignedSelf && (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">My sign-on</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signon-name">Name</Label>
            <Input
              id="signon-name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Signature</Label>
            <SignaturePad
              key={myPadKey}
              onChange={(d) => setMySignature(guardSignature(d))}
            />
          </div>
          <Button
            type="button"
            size="lg"
            disabled={pending || !mySignature}
            onClick={submitSelf}
          >
            {pending ? 'Signing…' : 'Sign on'}
          </Button>
        </div>
      )}

      {canRecordOthers &&
        (showOthers ? (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <p className="text-sm font-semibold">Others sign on this device</p>
            <p className="text-xs text-muted-foreground">
              Pass the phone around — each person enters their name and signs.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="other-name">Name</Label>
              <Input
                id="other-name"
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="other-company">Company (optional)</Label>
              <Input
                id="other-company"
                value={otherCompany}
                onChange={(e) => setOtherCompany(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Signature</Label>
              <SignaturePad
                key={otherPadKey}
                onChange={(d) => setOtherSignature(guardSignature(d))}
              />
            </div>
            <Button
              type="button"
              size="lg"
              disabled={pending || !otherSignature || !otherName.trim()}
              onClick={submitOther}
            >
              {pending ? 'Saving…' : 'Add sign-on'}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => setShowOthers(true)}
          >
            <UsersIcon className="size-4" />
            Others sign on this device
          </Button>
        ))}
    </div>
  )
}
