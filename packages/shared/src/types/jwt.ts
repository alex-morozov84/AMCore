import { SystemRole } from '../enums/roles'

// What gets encoded into JWT token
export interface JwtPayload {
  sub: string
  email: string
  systemRole: SystemRole
  organizationId?: string
  aclVersion?: number
}
