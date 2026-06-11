import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import { ProjectTabs } from './project-tabs'
import { ProjectStatusSelect } from './project-status-select'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select(
      `id, number, name, status,
       clients(id, name),
       sites(id, name),
       profiles!projects_supervisor_id_fkey(id, full_name)`
    )
    .eq('id', id)
    .single()

  if (!project) notFound()

  const clientRel = project.clients as unknown as { id: string; name: string } | null
  const siteRel = project.sites as unknown as { id: string; name: string } | null
  const supervisorRel = project.profiles as unknown as {
    id: string
    full_name: string
  } | null

  const canMutate = profile.role === 'admin' || profile.role === 'office'

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.number} — {project.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {canMutate ? (
            <ProjectStatusSelect projectId={project.id} status={project.status} />
          ) : (
            <StatusBadge status={project.status} />
          )}
          {clientRel && (
            <Link
              href={`/clients/${clientRel.id}`}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {clientRel.name}
            </Link>
          )}
          {siteRel && <span className="text-muted-foreground">{siteRel.name}</span>}
          {supervisorRel && (
            <span className="text-muted-foreground">{supervisorRel.full_name}</span>
          )}
        </div>
      </div>

      {/* Tab nav */}
      <ProjectTabs projectId={project.id} showMoney={canMutate} />

      {children}
    </div>
  )
}
