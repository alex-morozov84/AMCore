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
  notificationActionRouteSchema,
  NOTIFICATION_ACTION_MAX_PARAMS,
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
  updateNotificationSettingsSchema,
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
  type UpdateNotificationSettingsInput,
  type NotificationCapabilitiesResponse,
  type NotificationSseReason,
  type NotificationSseEvent,
} from './notifications'

// Telegram linking schemas (Track B — Arc D)
export {
  telegramConnectionStatusSchema,
  telegramLinkResponseSchema,
  telegramConnectionResponseSchema,
  type TelegramConnectionStatusValue,
  type TelegramLinkResponse,
  type TelegramConnectionResponse,
} from './telegram'

// AI capability layer schemas (Track C — ADR-054)
export {
  // Primitives
  AI_IDENTIFIER_MAX_LENGTH,
  AI_SLUG_MAX_LENGTH,
  aiIdentifierSchema,
  aiSlugSchema,
  AI_PROVIDER_TYPES,
  aiProviderTypeSchema,
  AI_CAPABILITIES,
  AI_CAPABILITY_MAX_ENTRIES,
  aiCapabilityMapSchema,
  AI_MODALITIES,
  aiModalitySchema,
  aiDecimalStringSchema,
  AI_CONFIG_MAX_KEYS,
  aiConfigObjectSchema,
  type AiProviderTypeValue,
  type AiCapabilityMap,
  type AiConfigObject,
} from './ai-common'

export {
  // Wire lifecycle enums
  aiRunStatusSchema,
  aiConversationStateSchema,
  aiConversationControlSchema,
  aiMessageRoleSchema,
  aiAuthorTypeSchema,
  aiToolRiskClassSchema,
  aiToolInvocationStatusSchema,
  aiApprovalKindSchema,
  aiApprovalStateSchema,
  aiArtifactKindSchema,
  aiArtifactTrustLevelSchema,
  type AiRunStatusValue,
  type AiConversationStateValue,
  type AiConversationControlValue,
} from './ai-enums'

export {
  // Catalog (provider / model / policy)
  aiDisplayNameSchema,
  aiProviderResponseSchema,
  createAiProviderSchema,
  updateAiProviderSchema,
  aiModelResponseSchema,
  createAiModelSchema,
  updateAiModelSchema,
  aiModelPolicyResponseSchema,
  updateAiModelPolicySchema,
  type AiProviderResponse,
  type CreateAiProviderInput,
  type UpdateAiProviderInput,
  type AiModelResponse,
  type CreateAiModelInput,
  type UpdateAiModelInput,
  type AiModelPolicyResponse,
  type UpdateAiModelPolicyInput,
} from './ai-catalog'

export {
  // Assistant configs
  aiModelSelectionSchema,
  AI_SYSTEM_PROMPT_MAX_LENGTH,
  aiAssistantResponseSchema,
  createAiAssistantSchema,
  type AiModelSelection,
  type AiAssistantResponse,
  type CreateAiAssistantInput,
} from './ai-assistants'

export {
  // Durable runs / conversations / messages / artifacts / usage
  AI_TEXT_PART_MAX_LENGTH,
  AI_MESSAGE_MAX_PARTS,
  aiMessageContentPartSchema,
  aiMessageContentSchema,
  aiConversationResponseSchema,
  createAiConversationSchema,
  aiMessageResponseSchema,
  aiRunResponseSchema,
  createAiRunSchema,
  aiArtifactResponseSchema,
  aiUsageSummarySchema,
  type AiMessageContentPart,
  type AiMessageContent,
  type AiConversationResponse,
  type CreateAiConversationInput,
  type AiMessageResponse,
  type AiRunResponse,
  type CreateAiRunInput,
  type AiArtifactResponse,
  type AiUsageSummary,
} from './ai-runs'

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
