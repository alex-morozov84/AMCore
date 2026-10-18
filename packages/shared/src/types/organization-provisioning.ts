import type { z } from 'zod'

import type {
  provisioningCreateSchema,
  provisioningCancelSchema,
  provisioningReissueSchema,
  provisioningReplaceSchema,
  provisioningReceiptSchema,
  provisioningProgressSchema,
  provisioningLookupSchema,
} from '../schemas/organization-provisioning'

export type ProvisioningCreate = z.infer<typeof provisioningCreateSchema>
export type ProvisioningCancel = z.infer<typeof provisioningCancelSchema>
export type ProvisioningReissue = z.infer<typeof provisioningReissueSchema>
export type ProvisioningReplace = z.infer<typeof provisioningReplaceSchema>
export type ProvisioningReceipt = z.infer<typeof provisioningReceiptSchema>
export type ProvisioningProgress = z.infer<typeof provisioningProgressSchema>
export type ProvisioningLookup = z.infer<typeof provisioningLookupSchema>
