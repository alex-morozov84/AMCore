import { SystemRole } from '../enums/roles'

// Unified identity on request.user — populated by any auth strategy
// Validated pattern: "IdentityBill" in @eropple/nestjs-auth, request.user in Passport
export interface RequestPrincipal {
  type: 'jwt' | 'api_key'
  sub: string // userId
  email?: string // always present for JWT; undefined for API keys
  systemRole: SystemRole
  organizationId?: string
  aclVersion?: number
  scopes?: string[] // API key only: ['contact:read', 'deal:create']
  // undefined = no restriction (JWT users)
}
// Effective permissions = userRolePermissions ∩ scopes (Auth0 validated pattern)
// JWT:     scopes = undefined → full role permissions
// API key: scopes = ['x:y']  → only permissions present in BOTH role AND scopes
