// Schemas public API

// Auth schemas
export {
  type AuthResponse,
  authResponseSchema,
  type AvatarResponse,
  avatarResponseSchema,
  type ChangePasswordInput,
  changePasswordSchema,
  type ForgotPasswordInput,
  forgotPasswordSchema,
  type LoginInput,
  loginSchema,
  type MessageResponse,
  messageResponseSchema,
  type OAuthExchangeRequest,
  oauthExchangeRequestSchema,
  type OAuthExchangeResponse,
  oauthExchangeResponseSchema,
  type OAuthProvidersResponse,
  oauthProvidersResponseSchema,
  parseSupportedLocale,
  type ProfileResponse,
  profileResponseSchema,
  type RefreshResponse,
  refreshResponseSchema,
  // Types
  type RegisterInput,
  // Request schemas
  registerSchema,
  type ResendVerificationInput,
  resendVerificationSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  type Session,
  sessionSchema,
  type SessionsListResponse,
  sessionsListResponseSchema,
  type StepUpInput,
  stepUpSchema,
  // Locale contract
  supportedLocaleSchema,
  timezoneSchema,
  type UpdateProfileInput,
  updateProfileSchema,
  type UserResponse,
  // Response schemas
  userResponseSchema,
  type VerifyEmailInput,
  verifyEmailSchema,
} from './auth'

// Organization schemas
export {
  type AssignPermissionInput,
  assignPermissionSchema,
  type CreateOrganizationInput,
  createOrganizationSchema,
  type CreateRoleInput,
  createRoleSchema,
  type OrganizationListResponse,
  organizationListResponseSchema,
  type OrgResponse,
  orgResponseSchema,
  type OrgRoleResponse,
  orgRoleResponseSchema,
  type PermissionResponse,
  permissionResponseSchema,
  type RoleListResponse,
  roleListResponseSchema,
  type SwitchOrgResponse,
  switchOrgResponseSchema,
  type UpdateOrganizationInput,
  updateOrganizationSchema,
  type UpdateRoleInput,
  updateRoleSchema,
} from './organization'

// Backwards compatibility
export { type User, userSchema } from './user'

// Admin schemas
export {
  type AdminOrganizationListResponse,
  adminOrganizationListResponseSchema,
  type AdminOrganizationResponse,
  adminOrganizationResponseSchema,
  type AdminUserListResponse,
  adminUserListResponseSchema,
  type AdminUserResponse,
  adminUserResponseSchema,
  type CleanupResultResponse,
  cleanupResultSchema,
  type UpdateUserSystemRoleInput,
  updateUserSystemRoleSchema,
} from './admin'

// Pagination schemas
export {
  type CursorResponse,
  cursorResponseSchema,
  type PaginatedResponse,
  paginatedResponseSchema,
  type PaginationQuery,
  paginationQuerySchema,
} from './pagination'

// API Keys schemas
export {
  type ApiKeyListItemResponse,
  apiKeyListItemSchema,
  type ApiKeyListResponse,
  apiKeyListResponseSchema,
  type CreateApiKeyInput,
  type CreateApiKeyResponse,
  createApiKeyResponseSchema,
  createApiKeySchema,
} from './api-keys'

// Notification schemas (Track B — ADR-052 / ADR-053)
export {
  type MarkAllReadResponse,
  markAllReadResponseSchema,
  NOTIFICATION_ACTION_MAX_PARAMS,
  NOTIFICATION_IDENTIFIER_MAX_LENGTH,
  // Realtime (SSE)
  NOTIFICATION_SSE_REASONS,
  // Types
  type NotificationAction,
  notificationActionRouteSchema,
  notificationActionSchema,
  type NotificationCapabilitiesResponse,
  notificationCapabilitiesResponseSchema,
  notificationCategoryCapabilitySchema,
  notificationCategorySchema,
  // Identifier grammar + action
  notificationChannelSchema,
  type NotificationFeedItem,
  notificationFeedItemSchema,
  type NotificationFeedQuery,
  // Feed (cursor)
  notificationFeedQuerySchema,
  type NotificationFeedResponse,
  notificationFeedResponseSchema,
  type NotificationPreferenceItem,
  // Preferences + capabilities
  notificationPreferenceItemSchema,
  type NotificationPreferencesResponse,
  notificationPreferencesResponseSchema,
  type NotificationSseEvent,
  notificationSseEventSchema,
  type NotificationSseReason,
  notificationTypeSchema,
  type UnreadCountResponse,
  unreadCountResponseSchema,
  type UpdateNotificationPreferenceInput,
  updateNotificationPreferenceSchema,
  type UpdateNotificationSettingsInput,
  updateNotificationSettingsSchema,
} from './notifications'

// Telegram linking schemas (Track B — Arc D)
export {
  type TelegramConnectionResponse,
  telegramConnectionResponseSchema,
  telegramConnectionStatusSchema,
  type TelegramConnectionStatusValue,
  type TelegramLinkResponse,
  telegramLinkResponseSchema,
} from './telegram'

// AI capability layer schemas (Track C — ADR-054)
export {
  // Human-in-the-loop approvals (read projection + decision input)
  AI_APPROVAL_REASON_MAX_LENGTH,
  type AiApprovalListQuery,
  aiApprovalListQuerySchema,
  type AiApprovalListResponse,
  aiApprovalListResponseSchema,
  type AiApprovalResponse,
  aiApprovalResponseSchema,
  type DecideAiApprovalInput,
  decideAiApprovalSchema,
} from './ai-approvals'
export {
  AI_SYSTEM_PROMPT_MAX_LENGTH,
  type AiAssistantListQuery,
  aiAssistantListQuerySchema,
  type AiAssistantListResponse,
  aiAssistantListResponseSchema,
  type AiAssistantResponse,
  aiAssistantResponseSchema,
  type AiModelSelection,
  // Assistant configs
  aiModelSelectionSchema,
  type CreateAiAssistantInput,
  createAiAssistantSchema,
  type PublishAiAssistantVersionInput,
  publishAiAssistantVersionSchema,
  type UpdateAiAssistantInput,
  updateAiAssistantSchema,
} from './ai-assistants'
export {
  // Catalog (provider / model / policy)
  aiDisplayNameSchema,
  type AiModelPolicyResponse,
  aiModelPolicyResponseSchema,
  type AiModelResponse,
  aiModelResponseSchema,
  type AiProviderResponse,
  aiProviderResponseSchema,
  type CreateAiModelInput,
  createAiModelSchema,
  type CreateAiProviderInput,
  createAiProviderSchema,
  type UpdateAiModelInput,
  type UpdateAiModelPolicyInput,
  updateAiModelPolicySchema,
  updateAiModelSchema,
  type UpdateAiProviderInput,
  updateAiProviderSchema,
} from './ai-catalog'
export {
  AI_CAPABILITIES,
  AI_CAPABILITY_MAX_ENTRIES,
  AI_CONFIG_MAX_KEYS,
  // Primitives
  AI_IDENTIFIER_MAX_LENGTH,
  AI_MODALITIES,
  AI_PROVIDER_TYPES,
  AI_SLUG_MAX_LENGTH,
  type AiCapabilityMap,
  aiCapabilityMapSchema,
  type AiConfigObject,
  aiConfigObjectSchema,
  aiDecimalStringSchema,
  aiIdentifierSchema,
  aiModalitySchema,
  aiProviderTypeSchema,
  type AiProviderTypeValue,
  aiSlugSchema,
} from './ai-common'
export {
  // Human takeover / operator review (Arc F.3)
  AI_CONTROL_REASON_MAX_LENGTH,
  AI_OPERATOR_REASON_HEADER,
  type AiControlReason,
  aiControlReasonSchema,
  type AiTextOnlyMessageContent,
  aiTextOnlyMessageContentSchema,
  type AiTranscriptQuery,
  aiTranscriptQuerySchema,
  type AiTranscriptResponse,
  aiTranscriptResponseSchema,
  type PostOperatorMessageInput,
  postOperatorMessageSchema,
  type ReleaseConversationInput,
  releaseConversationSchema,
  type TakeoverConversationInput,
  takeoverConversationSchema,
} from './ai-conversations'
export {
  aiApprovalKindSchema,
  aiApprovalStateSchema,
  aiArtifactKindSchema,
  aiArtifactTrustLevelSchema,
  aiAuthorTypeSchema,
  aiConversationControlSchema,
  type AiConversationControlValue,
  aiConversationStateSchema,
  type AiConversationStateValue,
  aiMessageRoleSchema,
  // Wire lifecycle enums
  aiRunStatusSchema,
  type AiRunStatusValue,
  aiToolInvocationStatusSchema,
  aiToolRiskClassSchema,
} from './ai-enums'
export {
  AI_MESSAGE_MAX_PARTS,
  AI_RUN_SSE_REASONS,
  // Durable runs / conversations / messages / artifacts / usage
  AI_TEXT_PART_MAX_LENGTH,
  type AiArtifactResponse,
  aiArtifactResponseSchema,
  type AiConversationResponse,
  aiConversationResponseSchema,
  type AiMessageContent,
  type AiMessageContentPart,
  aiMessageContentPartSchema,
  aiMessageContentSchema,
  type AiMessageResponse,
  aiMessageResponseSchema,
  type AiRunCancelResponse,
  aiRunCancelResponseSchema,
  type AiRunListQuery,
  aiRunListQuerySchema,
  type AiRunPage,
  aiRunPageSchema,
  type AiRunResponse,
  aiRunResponseSchema,
  type AiRunSseEvent,
  aiRunSseEventSchema,
  type AiRunSseReason,
  type AiUsageSummary,
  aiUsageSummarySchema,
  type CreateAiConversationInput,
  createAiConversationSchema,
  type CreateAiRunInput,
  createAiRunSchema,
} from './ai-runs'
export {
  type AiToolInvocationResponse,
  // Self-hosted tool loop (invocation read projection)
  aiToolInvocationResponseSchema,
} from './ai-tools'

// Invite schemas (OB-02)
export {
  type AcceptInviteInput,
  type AcceptInviteResponse,
  acceptInviteResponseSchema,
  acceptInviteSchema,
  type CreateInviteInput,
  createInviteSchema,
  type InviteListItem,
  inviteListItemSchema,
  type InviteListResponse,
  inviteListResponseSchema,
  type InviteResponse,
  inviteResponseSchema,
} from './invite'
