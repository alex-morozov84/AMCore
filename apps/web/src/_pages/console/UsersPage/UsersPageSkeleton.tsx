import { Skeleton } from '@/shared/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

const ROWS = Array.from({ length: 6 }, (_, index) => index)
const HEADER_WIDTHS = ['w-28', 'w-20', 'w-16', 'w-24', 'w-20', 'w-20']
const CELL_WIDTHS = ['w-16', 'w-20', 'w-24', 'w-24', 'w-24']

/** Mirrors the Users table structure, including its narrow-screen overflow behavior. */
export function UsersPageSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy="true">
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md">
        <Table>
          <TableHeader>
            <UsersSkeletonHeader />
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <UsersSkeletonRow key={row} />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function UsersSkeletonHeader() {
  return (
    <TableRow className="border-line-soft hover:bg-transparent">
      {HEADER_WIDTHS.map((width, index) => (
        <TableHead key={`${width}-${index}`}>
          <Skeleton className={`h-4 ${width}`} />
        </TableHead>
      ))}
    </TableRow>
  )
}

function UsersSkeletonRow() {
  return (
    <TableRow className="border-line-soft">
      <TableCell>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-1 h-3 w-48" />
      </TableCell>
      {CELL_WIDTHS.map((width, index) => (
        <TableCell key={`${width}-${index}`}>
          <Skeleton className={`h-5 ${width}`} />
        </TableCell>
      ))}
    </TableRow>
  )
}
