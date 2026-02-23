// Schemas public API

// Auth schemas
export {
  // Request schemas
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  // Response schemas
  userResponseSchema,
  authResponseSchema,
  sessionSchema,
  sessionsResponseSchema,
  refreshResponseSchema,
  messageResponseSchema,
  // Types
  type RegisterInput,
  type LoginInput,
  type UpdateProfileInput,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
  type ResendVerificationInput,
  type UserResponse,
  type AuthResponse,
  type Session,
  type SessionsResponse,
  type RefreshResponse,
  type MessageResponse,
} from './auth'

// Organization schemas
export {
  createOrganizationSchema,
  updateOrganizationSchema,
  inviteMemberSchema,
  createRoleSchema,
  updateRoleSchema,
  assignPermissionSchema,
  orgResponseSchema,
  permissionResponseSchema,
  orgRoleResponseSchema,
  switchOrgResponseSchema,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
  type InviteMemberInput,
  type CreateRoleInput,
  type UpdateRoleInput,
  type AssignPermissionInput,
  type OrgResponse,
  type PermissionResponse,
  type OrgRoleResponse,
  type SwitchOrgResponse,
} from './organization'

// Backwards compatibility
export { userSchema, type User } from './user'

// Admin schemas
export { updateUserSystemRoleSchema, type UpdateUserSystemRoleInput } from './admin'
