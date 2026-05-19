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
  oauthExchangeRequestSchema,
  // Response schemas
  userResponseSchema,
  authResponseSchema,
  sessionSchema,
  sessionsListResponseSchema,
  refreshResponseSchema,
  oauthExchangeResponseSchema,
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
  type OAuthExchangeRequest,
  type UserResponse,
  type AuthResponse,
  type Session,
  type SessionsListResponse,
  type RefreshResponse,
  type OAuthExchangeResponse,
  type MessageResponse,
} from './auth'

// Organization schemas
export {
  createOrganizationSchema,
  updateOrganizationSchema,
  createRoleSchema,
  updateRoleSchema,
  assignPermissionSchema,
  orgResponseSchema,
  organizationListResponseSchema,
  permissionResponseSchema,
  orgRoleResponseSchema,
  roleListResponseSchema,
  switchOrgResponseSchema,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
  type CreateRoleInput,
  type UpdateRoleInput,
  type AssignPermissionInput,
  type OrgResponse,
  type OrganizationListResponse,
  type PermissionResponse,
  type OrgRoleResponse,
  type RoleListResponse,
  type SwitchOrgResponse,
} from './organization'

// Backwards compatibility
export { userSchema, type User } from './user'

// Admin schemas
export {
  updateUserSystemRoleSchema,
  adminUserResponseSchema,
  adminUserListResponseSchema,
  adminOrganizationResponseSchema,
  adminOrganizationListResponseSchema,
  type UpdateUserSystemRoleInput,
  type AdminUserResponse,
  type AdminUserListResponse,
  type AdminOrganizationResponse,
  type AdminOrganizationListResponse,
} from './admin'

// Pagination schemas
export {
  paginationQuerySchema,
  paginatedResponseSchema,
  type PaginationQuery,
  type PaginatedResponse,
} from './pagination'

// API Keys schemas
export {
  createApiKeySchema,
  apiKeyListItemSchema,
  apiKeyListResponseSchema,
  type CreateApiKeyInput,
  type ApiKeyListItemResponse,
  type ApiKeyListResponse,
} from './api-keys'

// Invite schemas (OB-02)
export {
  createInviteSchema,
  acceptInviteSchema,
  inviteResponseSchema,
  acceptInviteResponseSchema,
  inviteListItemSchema,
  inviteListResponseSchema,
  type CreateInviteInput,
  type AcceptInviteInput,
  type InviteResponse,
  type AcceptInviteResponse,
  type InviteListItem,
  type InviteListResponse,
} from './invite'
