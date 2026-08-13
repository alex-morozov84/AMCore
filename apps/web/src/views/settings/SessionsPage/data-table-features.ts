import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'

/**
 * TanStack Table v9 (verified against the installed version and shadcn's
 * current `data-table` guide — `useTable`/`tableFeatures()`, not v8's
 * `useReactTable`). Server-side pagination only (the backend already
 * paginates — `page`/`limit` are plain state, not
 * `rowPaginationFeature`/`createPaginatedRowModel()`); client-side sorting
 * of the current page is the one interactive feature worth a reference
 * implementation here.
 */
export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
})

export type SessionsTableFeatures = typeof features
