import { Skeleton } from '@/shared/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

const ROWS = Array.from({ length: 6 }, (_, index) => index)
// Mirrors `UsersTable`'s real header order: User, Verification, System role,
// Last sign-in, Created, Updated, Actions — sortable columns get a touch of
// extra width to leave room for the always-visible sort icon next to the
// label.
const HEADER_WIDTHS = ['w-28', 'w-20', 'w-16', 'w-28', 'w-24', 'w-24', 'w-16']
const CELL_WIDTHS = ['w-16', 'w-20', 'w-24', 'w-24', 'w-24', 'w-8']

/**
 * Mirrors what `UsersResults` renders once its fetch settles: the
 * aria-live result count and the table, including its narrow-screen
 * overflow behavior. Deliberately excludes the heading and search box —
 * see `UsersPageSkeleton`, which composes this with those for the
 * cold/first-load case; `UsersPage`'s own `<Suspense>` around
 * `UsersResults` uses this skeleton alone for every later
 * search/sort/page navigation.
 */
export function UsersResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-5 w-20" />
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
    </div>
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
