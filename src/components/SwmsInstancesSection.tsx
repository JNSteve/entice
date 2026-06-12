'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  HistoryIcon,
  PlusIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuditHistory } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { ShareLinkDialog } from '@/components/ShareLinkDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtDate } from '@/lib/format'
import {
  createSwmsInstance,
  reviseSwmsInstance,
  supersedeSwmsInstance,
} from '@/lib/swms-actions'
import type { SwmsInstanceListRow } from '@/lib/swms-queries'

export interface SwmsTemplateOption {
  id: string
  title: string
  version: number
}

interface SwmsInstancesSectionProps {
  parentType: 'project' | 'job'
  parentId: string
  instances: SwmsInstanceListRow[]
  templates: SwmsTemplateOption[]
  /** admin/office/supervisor — add + revise. */
  canManage: boolean
  /** admin/office — supersede. */
  canSupersede: boolean
}

export function SwmsInstancesSection({
  parentType,
  parentId,
  instances,
  templates,
  canManage,
  canSupersede,
}: SwmsInstancesSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">SWMS</h2>
        {canManage && (
          <AddSwmsDialog
            parentType={parentType}
            parentId={parentId}
            templates={templates}
          />
        )}
      </div>
      {instances.length === 0 ? (
        <EmptyState
          icon={<ShieldCheckIcon className="size-8" />}
          title="No SWMS issued yet"
          description="Add a SWMS so field staff can sign on before starting work."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {instances.map((instance) => (
            <SwmsInstanceCard
              key={instance.id}
              instance={instance}
              canManage={canManage}
              canSupersede={canSupersede}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Instance card with sign-on register ─────────────────────────────────────

function SwmsInstanceCard({
  instance,
  canManage,
  canSupersede,
}: {
  instance: SwmsInstanceListRow
  canManage: boolean
  canSupersede: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [historyRows, setHistoryRows] = useState<AuditRow[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  async function loadHistory() {
    if (historyRows !== null) return // already loaded
    setHistoryLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('audit_log')
      .select('id, at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail')
      .eq('entity_type', 'swms_instances')
      .eq('entity_id', instance.id)
      .order('at', { ascending: false })
      .limit(100)
    setHistoryRows(
      (data ?? []).map((r) => ({
        id: r.id as string,
        at: r.at as string,
        actor_id: (r.actor_id as string | null) ?? null,
        actor_name: (r.actor_name as string | null) ?? null,
        entity_type: r.entity_type as string,
        entity_id: r.entity_id as string,
        project_id: (r.project_id as string | null) ?? null,
        action: r.action as string,
        detail: (r.detail ?? {}) as Record<string, unknown>,
      }))
    )
    setHistoryLoading(false)
  }

  const isActive = instance.status === 'active'

  function handleRevise() {
    if (
      !confirm(
        `Revise "${instance.title}" to v${instance.version + 1}? All field staff will need to re-sign.`
      )
    )
      return
    startTransition(async () => {
      const result = await reviseSwmsInstance(instance.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`SWMS revised to v${instance.version + 1}`)
    })
  }

  function handleSupersede() {
    if (!confirm(`Supersede "${instance.title}"? It will no longer be signable.`)) return
    startTransition(async () => {
      const result = await supersedeSwmsInstance(instance.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('SWMS superseded')
    })
  }

  return (
    <div className="rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{instance.title}</span>
            <Badge variant="secondary" className="tabular-nums">
              v{instance.version}
            </Badge>
            <StatusBadge status={instance.status} />
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !open
              setOpen(next)
              if (next) loadHistory()
            }}
            className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {instance.signedCount} of {instance.registerTotal} field staff signed
            {instance.externalSigners.length > 0 &&
              ` · ${instance.externalSigners.length} external`}
            {open ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {canManage && isActive && (
            <ShareLinkDialog
              target={{ swmsInstanceId: instance.id }}
              defaultLabel={instance.title}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/pdf/swms/${instance.id}`, '_blank')}
          >
            <FileTextIcon className="size-4" />
            PDF
          </Button>
          {canManage && isActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRevise}
              disabled={pending}
            >
              Revise
            </Button>
          )}
          {canSupersede && isActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSupersede}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              Supersede
            </Button>
          )}
        </div>
      </div>

      {/* Sign-on register */}
      {open && (
        <div className="border-t px-4 py-3 flex flex-col gap-4">
          {instance.register.length === 0 && instance.externalSigners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active field or supervisor staff to sign on.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Signed (v{instance.version})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instance.register.map((row) => (
                    <TableRow key={row.user_id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {row.role}
                      </TableCell>
                      <TableCell>
                        {row.signed_at ? (
                          <span className="tabular-nums">{fmtDate(row.signed_at)}</span>
                        ) : (
                          <span className="font-medium text-amber-600 dark:text-amber-400">
                            Outstanding
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {instance.externalSigners.map((signer) => (
                    <TableRow key={signer.id}>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          {signer.name}
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-slate-50 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400"
                          >
                            External
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {signer.company ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">{fmtDate(signer.signed_at)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* SWMS history */}
          <div className="border-t pt-3">
            <div className="flex items-center gap-2 mb-2">
              <HistoryIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                History
              </span>
            </div>
            {historyLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <AuditHistory rows={historyRows ?? []} heading="" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add SWMS dialog ─────────────────────────────────────────────────────────

function AddSwmsDialog({
  parentType,
  parentId,
  templates,
}: {
  parentType: 'project' | 'job'
  parentId: string
  templates: SwmsTemplateOption[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [templateId, setTemplateId] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createSwmsInstance({
        template_id: templateId,
        project_id: parentType === 'project' ? parentId : null,
        job_id: parentType === 'job' ? parentId : null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('SWMS added — field staff can now sign on')
      setOpen(false)
      setTemplateId('')
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        Add SWMS
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add SWMS</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="swms-template">Template</Label>
              <Select
                value={templateId}
                onValueChange={(v) => setTemplateId(v ?? '')}
              >
                <SelectTrigger id="swms-template" className="w-full">
                  <SelectValue placeholder="Pick a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active SWMS templates — create one in Settings → SWMS.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !templateId}>
                {pending ? 'Adding…' : 'Add SWMS'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
