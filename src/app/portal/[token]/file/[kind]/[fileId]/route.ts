import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'
import { buildSwmsPdfResponse } from '@/pdf/build-swms-pdf'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Portal file gate: GET /portal/[token]/file/[kind]/[fileId]
 *
 * 1. portal_file_path (anon security-definer RPC) proves the token is live
 *    AND entitled to this exact object — a compliance item's evidence on one
 *    of the client's own sites, or a client_visible job/project attachment —
 *    and logs the download to portal_views. Anything else returns null.
 * 2. Only then does the service-role client act:
 *    - a PDF that backs a SWMS is served as its signed copy — the original
 *      pages with the current sign-on register appended, the same document
 *      the office "Signed copy" button produces. Built live, never cached.
 *    - anything else gets a short-lived signed URL (the anon role has no
 *      storage read on the private bucket — signing stays server-side here,
 *      never in the RPC or the browser).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; kind: string; fileId: string }> }
) {
  const { token, kind, fileId } = await params

  if ((kind !== 'item' && kind !== 'attachment') || !UUID_RE.test(fileId)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const supabase = createPublicClient()
  const { data } = await supabase.rpc('portal_file_path', {
    p_token: token,
    p_kind: kind,
    p_id: fileId,
  })
  const file = (data ?? null) as { path: string; filename: string | null } | null
  if (!file?.path) {
    return new NextResponse('Not found', { status: 404 })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return new NextResponse('File temporarily unavailable', { status: 503 })
  }

  if (kind === 'attachment') {
    const { data: swmsRows } = await admin
      .from('swms_instances')
      .select('id')
      .eq('document_attachment_id', fileId)
      .order('created_at', { ascending: false })
      .limit(1)
    const swmsId = (swmsRows?.[0]?.id as string | undefined) ?? null
    if (swmsId) {
      const response = await buildSwmsPdfResponse(admin, swmsId)
      // The register grows as crew sign — never let a browser or CDN keep a copy.
      response.headers.set('Cache-Control', 'no-store')
      return response
    }
  }

  const { data: signed, error } = await admin.storage
    .from('attachments')
    .createSignedUrl(file.path, 300, {
      download: false,
    })
  if (error || !signed?.signedUrl) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.redirect(signed.signedUrl, 302)
}
