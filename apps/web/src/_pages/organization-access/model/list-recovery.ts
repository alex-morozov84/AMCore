import type { OrganizationListResponse } from '@amcore/shared'

/** Total and rows are not a snapshot; permit one explicit recovery, never a loop. */
export function organizationListNeedsRecovery(list: OrganizationListResponse) {
  const { page, total, limit } = list
  const totalPages = Math.ceil(total / limit)
  return (
    limit !== 20 ||
    page > Math.max(1, totalPages) ||
    (total === 0 ? list.data.length !== 0 : list.data.length === 0) ||
    (total === 1 && (page !== 1 || list.data.length !== 1))
  )
}
