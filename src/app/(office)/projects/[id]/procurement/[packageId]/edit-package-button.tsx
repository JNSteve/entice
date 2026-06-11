'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PencilIcon } from 'lucide-react'
import { PackageDialog } from '../package-dialog'
import type { PackageRow, CostCodeOption, OwnerOption } from '../packages-table'

interface EditPackageButtonProps {
  projectId: string
  pkg: PackageRow
  costCodes: CostCodeOption[]
  owners: OwnerOption[]
}

export function EditPackageButton({
  projectId,
  pkg,
  costCodes,
  owners,
}: EditPackageButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilIcon className="size-4" />
        Edit
      </Button>
      {open && (
        <PackageDialog
          projectId={projectId}
          pkg={pkg}
          costCodes={costCodes}
          owners={owners}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}
