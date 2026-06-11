'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

interface Column<T> {
  key: string
  header: React.ReactNode
  className?: string
  render: (row: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  onRowHref?: (row: T) => string
  empty?: React.ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowHref,
  empty,
}: DataTableProps<T>) {
  const router = useRouter()

  if (rows.length === 0 && empty) {
    return <>{empty}</>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={col.className}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
              No results
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const href = onRowHref?.(row)
            return (
              <TableRow
                key={getRowKey(row)}
                className={href ? 'cursor-pointer hover:bg-muted/50' : undefined}
                onClick={href ? (e) => {
                  if ((e.target as HTMLElement).closest('button,a,input,select,textarea,[role="menuitem"],[role="checkbox"]')) return
                  router.push(href)
                } : undefined}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
