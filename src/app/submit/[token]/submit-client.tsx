'use client'

import React, { useState, useTransition } from 'react'
import { CheckCircle2Icon, FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createPublicClient } from '@/lib/supabase/public'
import { submitSubbieSwms } from './actions'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB

/**
 * Submission form for the public /submit/[token] page: company + contact +
 * email + SWMS title + PDF picker. The PDF goes straight to storage from the
 * browser with the anon client (insert-only public-submissions/ prefix), then
 * the server action records the row via the submit_subbie_swms RPC.
 * Each attempt uploads under a fresh UUID, so a failed RPC can simply retry.
 */
export function SubmitClient({ token }: { token: string }) {
  const [pending, startTransition] = useTransition()

  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [done, setDone] = useState<{ company: string } | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    if (!picked) {
      setFile(null)
      return
    }
    if (picked.type !== 'application/pdf') {
      toast.error('Attach your SWMS as a PDF file')
      e.target.value = ''
      setFile(null)
      return
    }
    if (picked.size > MAX_FILE_BYTES) {
      toast.error('PDF is too large — maximum 15MB')
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(picked)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast.error('Attach your SWMS PDF first')
      return
    }
    startTransition(async () => {
      // 1. Upload from the browser with the anon client. The storage policy
      //    only permits inserts under public-submissions/ (no reads).
      const path = `public-submissions/${crypto.randomUUID()}.pdf`
      const supabase = createPublicClient()
      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(path, file, { contentType: 'application/pdf' })
      if (uploadError) {
        toast.error('Could not upload your PDF — check your connection and try again.')
        return
      }

      // 2. Record the submission (server action → security-definer RPC).
      const result = await submitSubbieSwms({
        token,
        company: company.trim(),
        contact: contact.trim(),
        email: email.trim(),
        title: title.trim(),
        filePath: path,
      })
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      setDone({ company: company.trim() })
    })
  }

  if (done) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-6 py-10 text-center">
        <CheckCircle2Icon className="size-10 text-green-600 dark:text-green-400" />
        <h2 className="text-lg font-bold">
          Thanks — {done.company}, your SWMS has been submitted for review.
        </h2>
        <p className="text-sm text-muted-foreground">
          The site team will be in touch if anything else is needed. You can
          close this page now.
        </p>
      </section>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submit-company">Company name</Label>
        <Input
          id="submit-company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submit-contact">Contact name</Label>
        <Input
          id="submit-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          autoComplete="name"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submit-email">Email</Label>
        <Input
          id="submit-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submit-title">SWMS title</Label>
        <Input
          id="submit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Balcony membrane works SWMS rev C"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submit-file">SWMS document (PDF, max 15MB)</Label>
        <Input
          id="submit-file"
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          required
        />
        {file && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileTextIcon className="size-3.5" />
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
          </p>
        )}
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={
          pending ||
          !file ||
          !company.trim() ||
          !contact.trim() ||
          !email.trim() ||
          !title.trim()
        }
      >
        {pending ? 'Submitting…' : 'Submit SWMS'}
      </Button>
    </form>
  )
}
