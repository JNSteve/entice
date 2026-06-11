'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PlusIcon } from 'lucide-react'
import { PackageDialog } from './package-dialog'
import type { CostCodeOption, OwnerOption } from './packages-table'

interface NewPackageButtonProps {
  projectId: string
  costCodes: CostCodeOption[]
  owners: OwnerOption[]
}

export function NewPackageButton({ projectId, costCodes, owners }: NewPackageButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New package
      </Button>
      <PackageDialog
        projectId={projectId}
        costCodes={costCodes}
        owners={owners}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
