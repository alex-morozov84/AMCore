import type {
  DeleteRoleDefinitionResponse,
  RoleDefinitionDetail,
  SaveRoleDefinitionResponse,
} from '@amcore/shared'

import type { OrganizationWriteOutcome } from '../access-controller'

export type RoleCreateOutcome = OrganizationWriteOutcome<RoleDefinitionDetail>
export type RoleSaveOutcome = OrganizationWriteOutcome<SaveRoleDefinitionResponse>
export type RoleDeleteOutcome = OrganizationWriteOutcome<DeleteRoleDefinitionResponse>

/**
 * Deliberate 4xx answers a role command may receive. Everything else (5xx, a lost response, an
 * invalid acknowledgment, `ROLE_SAVE_UNAVAILABLE`) is an UNKNOWN outcome: the write may have
 * committed, so a consumer must read the persisted state and never replay it automatically.
 */
export const ROLE_REJECTION_CODES: ReadonlySet<string> = new Set([
  'ROLE_UNAVAILABLE',
  'ROLE_SYSTEM_IMMUTABLE',
  'ROLE_NAME_CONFLICT',
  'ROLE_NAME_RESERVED',
  'ROLE_DEFINITION_CONFLICT',
  'ROLE_FULL_CONTROL_ACK_REQUIRED',
  'ROLE_SELF_HELD_ACK_REQUIRED',
  'ROLE_DEFINITION_OVERSIZED',
  'ROLE_DELETE_IMPACT_CHANGED',
  'CAPABILITY_UNSUPPORTED',
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'AUTH_ORIGIN_REJECTED',
  'CONTEXT_SESSION_CHANGED',
  'RATE_LIMIT_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
])
