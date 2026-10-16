import type { z } from 'zod'

import type {
  organizationBootstrapResultSchema,
  organizationBootstrapSchema,
  organizationCreationPolicySchema,
  organizationCreationRequestSchema,
  organizationCreationResultSchema,
  organizationPrepareAccountSchema,
  organizationPreparedAccountSchema,
  organizationSetupAccountSchema,
  organizationSetupIdsSchema,
  organizationSetupStateSchema,
  organizationSetupStatusSchema,
} from '../schemas/organization-establishment'

export type OrganizationCreationPolicy = z.infer<typeof organizationCreationPolicySchema>
export type OrganizationCreationRequest = z.infer<typeof organizationCreationRequestSchema>
export type OrganizationCreationResult = z.infer<typeof organizationCreationResultSchema>
export type OrganizationSetupState = z.infer<typeof organizationSetupStateSchema>
export type OrganizationSetupStatus = z.infer<typeof organizationSetupStatusSchema>
export type OrganizationPrepareAccount = z.infer<typeof organizationPrepareAccountSchema>
export type OrganizationPreparedAccount = z.infer<typeof organizationPreparedAccountSchema>
export type OrganizationSetupAccount = z.infer<typeof organizationSetupAccountSchema>
export type OrganizationBootstrap = z.infer<typeof organizationBootstrapSchema>
export type OrganizationBootstrapResult = z.infer<typeof organizationBootstrapResultSchema>

export type OrganizationSetupIds = z.infer<typeof organizationSetupIdsSchema>
