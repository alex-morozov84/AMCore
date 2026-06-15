// Schemas public API

// Auth schemas
export {
  // Locale contract
  supportedLocaleSchema,
  timezoneSchema,
  parseSupportedLocale,
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
  stepUpSchema,
  // Response schemas
  userResponseSchema,
  authResponseSchema,
  sessionSchema,
  sessionsListResponseSchema,
  refreshResponseSchema,
  oauthExchangeResponseSchema,
  messageResponseSchema,
  profileResponseSchema,
  avatarResponseSchema,
  oauthProvidersResponseSchema,
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
  type StepUpInput,
  type UserResponse,
  type AuthResponse,
  type Session,
  type SessionsListResponse,
  type RefreshResponse,
  type OAuthExchangeResponse,
  type MessageResponse,
  type ProfileResponse,
  type AvatarResponse,
  type OAuthProvidersResponse,
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
  cleanupResultSchema,
  type UpdateUserSystemRoleInput,
  type AdminUserResponse,
  type AdminUserListResponse,
  type AdminOrganizationResponse,
  type AdminOrganizationListResponse,
  type CleanupResultResponse,
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
  createApiKeyResponseSchema,
  type CreateApiKeyInput,
  type ApiKeyListItemResponse,
  type ApiKeyListResponse,
  type CreateApiKeyResponse,
} from './api-keys'

// Notification schemas (Track B — ADR-052 / ADR-053)
export {
  // Identifier grammar + action
  notificationChannelSchema,
  notificationCategorySchema,
  notificationTypeSchema,
  notificationActionSchema,
  NOTIFICATION_IDENTIFIER_MAX_LENGTH,
  // Feed (cursor)
  notificationFeedQuerySchema,
  cursorResponseSchema,
  notificationFeedItemSchema,
  notificationFeedResponseSchema,
  unreadCountResponseSchema,
  markAllReadResponseSchema,
  // Preferences + capabilities
  notificationPreferenceItemSchema,
  notificationPreferencesResponseSchema,
  updateNotificationPreferenceSchema,
  notificationCategoryCapabilitySchema,
  notificationCapabilitiesResponseSchema,
  // Realtime (SSE)
  NOTIFICATION_SSE_REASONS,
  notificationSseEventSchema,
  // Types
  type NotificationAction,
  type NotificationFeedQuery,
  type CursorResponse,
  type NotificationFeedItem,
  type NotificationFeedResponse,
  type UnreadCountResponse,
  type MarkAllReadResponse,
  type NotificationPreferenceItem,
  type NotificationPreferencesResponse,
  type UpdateNotificationPreferenceInput,
  type NotificationCapabilitiesResponse,
  type NotificationSseReason,
  type NotificationSseEvent,
} from './notifications'

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
