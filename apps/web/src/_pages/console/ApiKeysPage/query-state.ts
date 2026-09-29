import type { AdminApiKeyQuery } from '@amcore/shared'

export function keyDiscoveryState(query: AdminApiKeyQuery) {
  return {
    page: query.page,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    extraQuery: {
      status: query.status,
      userId: query.userId,
      organizationId: query.organizationId,
      id: query.id,
      limit: String(query.limit),
    },
  }
}
