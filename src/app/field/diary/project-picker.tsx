'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon, SearchIcon } from 'lucide-react'

export type PickerProject = {
  id: string
  number: string
  name: string
}

function ProjectLink({ project }: { project: PickerProject }) {
  return (
    <Link
      href={`/field/diary/${project.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 transition-colors hover:bg-muted/50 active:bg-muted"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          P-{project.number}
        </span>
        <span className="truncate text-sm font-medium">{project.name}</span>
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export function ProjectPicker({
  assigned,
  others,
}: {
  assigned: PickerProject[]
  others: PickerProject[]
}) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? others.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.number.toLowerCase().includes(q)
      )
    : others

  return (
    <div className="flex flex-col gap-5">
      {assigned.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assigned today
          </p>
          {assigned.map((p) => (
            <ProjectLink key={p.id} project={p} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          All active projects
        </p>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border bg-background py-2.5 pl-9 pr-3 text-sm"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {others.length === 0 ? 'No active projects.' : 'No projects match your search.'}
          </p>
        ) : (
          filtered.map((p) => <ProjectLink key={p.id} project={p} />)
        )}
      </div>
    </div>
  )
}
