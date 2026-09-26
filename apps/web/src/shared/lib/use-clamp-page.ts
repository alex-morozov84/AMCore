'use client'

import { useEffect } from 'react'

/**
 * Steps `page` back to the last valid page once `total` shrinks out from
 * under it (e.g. a revoke drops the row count below what the current page
 * needs). The backend returns an empty page rather than clamping it
 * itself, which would otherwise read as a false "empty" state while later
 * pages still hold data.
 */
export function useClampPage(
  page: number,
  setPage: (page: number) => void,
  total: number | undefined,
  pageSize: number
) {
  useEffect(() => {
    if (total === undefined) return
    const lastPage = Math.max(1, Math.ceil(total / pageSize))
    if (page > lastPage) setPage(lastPage)
  }, [total, page, pageSize, setPage])
}
