import {
  type ProductAccessBootstrap,
  productAccessBootstrapSchema,
  type ProductOrganizationContext,
  productOrganizationContextSchema,
  type ProductOrganizationList,
  productOrganizationListSchema,
} from '@amcore/shared'

import { apiClient } from '@/shared/api/http-client'

import type { OrganizationContextInput } from '../model/context-input'

export type OrganizationContextData = ProductOrganizationList | ProductOrganizationContext

export const organizationContextClient = {
  bootstrap: async (signal: AbortSignal): Promise<ProductAccessBootstrap> =>
    productAccessBootstrapSchema.parse(
      await apiClient.get('/product-access/bootstrap', { signal })
    ),
  authority: async (
    input: OrganizationContextInput,
    binding: string,
    signal: AbortSignal
  ): Promise<OrganizationContextData> => {
    const path =
      input.kind === 'list'
        ? `/product-access/organizations?page=${input.page}`
        : `/product-access/organizations/${encodeURIComponent(input.id)}/context`
    const data = await apiClient.get(path, {
      headers: { 'X-AMCore-Context-Session': binding },
      signal,
    })
    return input.kind === 'list'
      ? productOrganizationListSchema.parse(data)
      : productOrganizationContextSchema.parse(data)
  },
}
