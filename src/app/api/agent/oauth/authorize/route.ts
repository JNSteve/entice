import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import {
  AUTH_CODE_TTL_SECONDS,
  escapeHtml,
  isRegisteredRedirect,
  randomToken,
  sha256Hex,
} from '@/lib/agent-oauth'
import { findClient } from '@/lib/agent-oauth-server'

export const runtime = 'nodejs'

/**
 * OAuth authorization endpoint + consent screen.
 *
 * GET  — validate the request, then render a consent page (admin session required).
 * POST — the Approve/Deny form target; on approve, mint a single-use code and
 *        302 back to the client's registered redirect_uri.
 *
 * Only an ADMIN may approve: a grant hands an external agent full read/write
 * over live company data, so it is the same bar as minting a static key.
 *
 * Errors that cannot be safely redirected (unknown client / unregistered
 * redirect_uri) are shown as HTML instead of bounced, per RFC 6749 §4.1.2.1 —
 * redirecting them would turn this endpoint into an open redirector.
 */

type Params = {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  codeChallengeMethod: string
  scope: string | null
  resource: string | null
}

function readParams(url: URL): Params {
  return {
    clientId: url.searchParams.get('client_id') ?? '',
    redirectUri: url.searchParams.get('redirect_uri') ?? '',
    state: url.searchParams.get('state'),
    codeChallenge: url.searchParams.get('code_challenge') ?? '',
    codeChallengeMethod: url.searchParams.get('code_challenge_method') ?? '',
    scope: url.searchParams.get('scope'),
    resource: url.searchParams.get('resource'),
  }
}

function page(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f4f4f2; color:#2c2c2c;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:24px; }
  .card { background:#fff; border:1px solid #e3e3df; border-radius:12px; max-width:460px; width:100%;
    padding:28px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size:19px; margin:0 0 6px; color:#162040; }
  p { font-size:14px; line-height:1.55; margin:10px 0; }
  .muted { color:#5b5b57; font-size:13px; }
  ul { font-size:13.5px; line-height:1.6; padding-left:18px; margin:12px 0; }
  .row { display:flex; gap:10px; margin-top:22px; }
  button, .btn { font:inherit; font-size:14px; font-weight:600; border-radius:8px; padding:10px 16px;
    border:1px solid transparent; cursor:pointer; text-decoration:none; display:inline-block; }
  .primary { background:#162040; color:#fff; }
  .secondary { background:#fff; color:#2c2c2c; border-color:#d5d5d0; }
  code { background:#f0f0ec; padding:1px 5px; border-radius:4px; font-size:12.5px; }
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

async function validate(p: Params) {
  if (!p.clientId || !p.redirectUri) {
    return { error: page('Invalid request', '<h1>Invalid request</h1><p>Missing <code>client_id</code> or <code>redirect_uri</code>.</p>', 400) }
  }
  if (p.codeChallengeMethod !== 'S256' || !p.codeChallenge) {
    return { error: page('Invalid request', '<h1>Invalid request</h1><p>PKCE with <code>code_challenge_method=S256</code> is required.</p>', 400) }
  }
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return { error: page('Unavailable', '<h1>Unavailable</h1><p>The agent API is not configured on this deployment.</p>', 503) }
  }
  const client = await findClient(admin, p.clientId)
  if (!client) {
    return { error: page('Unknown client', '<h1>Unknown client</h1><p>That application is not registered.</p>', 400) }
  }
  if (!isRegisteredRedirect(p.redirectUri, client.redirect_uris)) {
    // Never redirect here — that would make this an open redirector.
    return { error: page('Invalid redirect', '<h1>Invalid redirect</h1><p>That <code>redirect_uri</code> is not registered for this application.</p>', 400) }
  }
  return { admin, client }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const p = readParams(url)
  const checked = await validate(p)
  if ('error' in checked) return checked.error
  const { client } = checked

  // Identify the human via the normal portal session.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const next = `${url.pathname}${url.search}`
    const loginUrl = `/login?next=${encodeURIComponent(next)}`
    return page(
      'Sign in required',
      `<h1>Sign in to continue</h1>
       <p><strong>${escapeHtml(client.client_name ?? client.client_id)}</strong> is asking to connect to your ECR portal.</p>
       <p class="muted">Sign in as an administrator to review the request. You'll come straight back here.</p>
       <div class="row"><a class="btn primary" href="${escapeHtml(loginUrl)}">Sign in</a></div>`
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return page(
      'Not permitted',
      `<h1>Administrator access required</h1>
       <p>Connecting an agent grants full read and write access to company data, so only an administrator can approve it.</p>
       <p class="muted">You are signed in as ${escapeHtml(profile?.full_name ?? user.email ?? 'a non-admin user')}.</p>`,
      403
    )
  }

  const hidden = (name: string, value: string | null) =>
    value === null ? '' : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`

  return page(
    'Connect to ECR portal',
    `<h1>Connect ${escapeHtml(client.client_name ?? 'this application')}?</h1>
     <p><strong>${escapeHtml(client.client_name ?? client.client_id)}</strong> is asking to connect to your ECR portal as an agent.</p>
     <p class="muted">If approved it will be able to:</p>
     <ul>
       <li>Read any data in the portal database and storage</li>
       <li>Create, update and delete records</li>
     </ul>
     <p class="muted">Every action it takes is recorded in the agent audit log, and you can revoke this connection at any time.</p>
     <form method="POST">
       ${hidden('client_id', p.clientId)}
       ${hidden('redirect_uri', p.redirectUri)}
       ${hidden('state', p.state)}
       ${hidden('code_challenge', p.codeChallenge)}
       ${hidden('code_challenge_method', p.codeChallengeMethod)}
       ${hidden('scope', p.scope)}
       ${hidden('resource', p.resource)}
       <div class="row">
         <button class="primary" name="decision" value="approve" type="submit">Approve</button>
         <button class="secondary" name="decision" value="deny" type="submit">Cancel</button>
       </div>
     </form>
     <p class="muted" style="margin-top:18px">Signed in as ${escapeHtml(profile?.full_name ?? user.email ?? '')}.</p>`
  )
}

export async function POST(request: Request) {
  const form = await request.formData()
  const get = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' ? v : null
  }
  const p: Params = {
    clientId: get('client_id') ?? '',
    redirectUri: get('redirect_uri') ?? '',
    state: get('state'),
    codeChallenge: get('code_challenge') ?? '',
    codeChallengeMethod: get('code_challenge_method') ?? '',
    scope: get('scope'),
    resource: get('resource'),
  }

  const checked = await validate(p)
  if ('error' in checked) return checked.error
  const { admin } = checked

  // Re-check the session on POST — never trust the form alone.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return page('Sign in required', '<h1>Session expired</h1><p>Please start the connection again.</p>', 401)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin')
    return page('Not permitted', '<h1>Administrator access required</h1>', 403)

  const redirect = new URL(p.redirectUri)
  if (p.state) redirect.searchParams.set('state', p.state)

  if (get('decision') !== 'approve') {
    redirect.searchParams.set('error', 'access_denied')
    return NextResponse.redirect(redirect.toString(), 302)
  }

  const code = randomToken(32)
  const { error } = await admin.from('agent_oauth_codes').insert({
    code_hash: sha256Hex(code),
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    scope: p.scope,
    resource: p.resource,
    approved_by: user.id,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) {
    redirect.searchParams.set('error', 'server_error')
    return NextResponse.redirect(redirect.toString(), 302)
  }

  redirect.searchParams.set('code', code)
  return NextResponse.redirect(redirect.toString(), 302)
}
