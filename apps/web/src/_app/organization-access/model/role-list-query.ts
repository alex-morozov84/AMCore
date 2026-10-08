import { roleDefinitionListQuerySchema } from '@amcore/shared'

/** A malformed or out-of-range query falls back to the first page instead of failing the page. */
export function organizationRoleListQuery(raw: Record<string, string | string[] | undefined>) {
  const parsed = roleDefinitionListQuerySchema.safeParse({
    page: raw.page,
    search: raw.search,
    limit: 20,
  })
  return parsed.success
    ? { page: parsed.data.page, search: parsed.data.search ?? '' }
    : { page: 1, search: '' }
}
