import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'
import { photoUploadProblem } from '@/lib/portal-interactions'

export const runtime = 'nodejs'

/**
 * Guarded photo upload for portal work requests:
 * POST /portal/[token]/request-upload (multipart, field "files", ≤5 images,
 * ≤10MB each, JPEG/PNG/WebP/GIF only).
 *
 * 1. portal_register_upload (anon security-definer RPC) proves the token is
 *    live, rate-limits uploads per link (logged to portal_views) and returns
 *    the link id that namespaces the storage prefix.
 * 2. Only then does the service-role client store the blobs under
 *    portal-requests/<link id>/… in the private attachments bucket — a prefix
 *    only admin/office can read, and one portal_submit_request pins request
 *    photo paths to (you cannot attach another link's uploads).
 *
 * The returned paths are then passed to the submitPortalRequest action.
 */

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

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

  const files = form
    .getAll('files')
    .filter((f): f is File => f instanceof File)

  const problem = photoUploadProblem(
    files.map((f) => ({ type: f.type, size: f.size }))
  )
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 })
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

  const paths: string[] = []
  for (const file of files) {
    const ext = EXT_BY_TYPE[file.type]
    const path = `portal-requests/${gate.link_id}/${crypto.randomUUID()}.${ext}`
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
    paths.push(path)
  }

  return NextResponse.json({ paths })
}
