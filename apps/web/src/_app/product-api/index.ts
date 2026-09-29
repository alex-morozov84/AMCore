import { ORGANIZATION_CONTEXT_FAMILY } from '@/entities/organization-context/index.server'

/** Application composition: downstream tenant modules contribute their public family here. */
export const productOrganizationFamilies = Object.freeze([ORGANIZATION_CONTEXT_FAMILY])
