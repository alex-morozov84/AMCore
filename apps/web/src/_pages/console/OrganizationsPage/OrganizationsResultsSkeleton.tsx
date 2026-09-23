import { Skeleton } from '@/shared/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

const ROWS = Array.from({ length: 6 }, (_, index) => index)
// Mirrors `OrganizationsTable`'s real header order: Name, Slug, Created,
// Updated — every column is sortable, so each gets a touch of extra width
// to leave room for the always-visible sort icon next to the label.
const HEADER_WIDTHS = ['w-28', 'w-24', 'w-24', 'w-24']
const CELL_WIDTHS = ['w-32', 'w-40', 'w-24', 'w-24']

/**
 * Mirrors what `OrganizationsResults` renders once its fetch settles: the
 * aria-live result count and the table, including its narrow-screen
 * overflow behavior. Deliberately excludes the heading and search box —
 * see `OrganizationsPageSkeleton`, which composes this with those for the
 * cold/first-load case; `OrganizationsPage`'s own `<Suspense>` around
 * `OrganizationsResults` uses this skeleton alone for every later
 * search/sort/page navigation.
 */
export function OrganizationsResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-5 w-20" />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md">
        <Table>
          <TableHeader>
            <OrganizationsSkeletonHeader />
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <OrganizationsSkeletonRow key={row} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function OrganizationsSkeletonHeader() {
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

function OrganizationsSkeletonRow() {
  return (
    <TableRow className="border-line-soft">
      {CELL_WIDTHS.map((width, index) => (
        <TableCell key={`${width}-${index}`}>
          <Skeleton className={`h-5 ${width}`} />
        </TableCell>
      ))}
    </TableRow>
  )
}
