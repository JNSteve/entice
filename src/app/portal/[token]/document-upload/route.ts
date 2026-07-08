import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Guarded document upload for client compliance filings:
 * POST /portal/[token]/document-upload (multipart, field "file", ONE file,
 * ≤10MB, PDF or image).
 *
 * Mirrors request-upload: portal_register_upload (anon definer RPC) proves
 * the token is live and rate-limits per link, then the service-role client
 * stores the blob under portal-uploads/<link id>/… in the private
 * attachments bucket — a prefix portal_submit_upload pins metadata rows to,
 * and only admin/office can read. The returned path is then passed to the
 * submitPortalUpload action; nothing appears in the register until office
 * approves it.
 */

const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach a document' }, { status: 400 })
  }
  if (!EXT_BY_TYPE[file.type]) {
    return NextResponse.json(
      { error: 'Only PDF or image files can be uploaded' },
      { status: 400 }
    )
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Files must be under 10MB' },
      { status: 400 }
    )
  }

  // Token + rate-limit gate (the RPC returns null for dead tokens).
  const supabase = createPublicClient()
  const { data } = await supabase.rpc('portal_register_upload', {
    p_token: token,
  })
  const gate = (data ?? null) as { allowed?: boolean; link_id?: string } | null
  if (!gate) {
    return NextResponse.json({ error: 'Link inactive' }, { status: 404 })
  }
  if (!gate.allowed || !gate.link_id) {
    return NextResponse.json(
      { error: 'Upload limit reached for today — please try again tomorrow.' },
      { status: 429 }
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: 'Uploads temporarily unavailable' },
      { status: 503 }
    )
  }

  const path = `portal-uploads/${gate.link_id}/${crypto.randomUUID()}.${EXT_BY_TYPE[file.type]}`
  const { error } = await admin.storage
    .from('attachments')
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    })
  if (error) {
    return NextResponse.json(
      { error: 'Upload failed — please try again.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ path })
}
