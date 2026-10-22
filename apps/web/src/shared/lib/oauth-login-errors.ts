import { AuthErrorCode } from '@amcore/shared'

export const oauthLoginErrors: ReadonlySet<string> = new Set([
  AuthErrorCode.OAUTH_STATE_INVALID,
  AuthErrorCode.OAUTH_PROVIDER_ERROR,
  AuthErrorCode.OAUTH_EMAIL_REQUIRED,
  AuthErrorCode.OAUTH_EMAIL_UNVERIFIED,
  AuthErrorCode.OAUTH_ACCOUNT_ALREADY_LINKED,
  AuthErrorCode.OAUTH_PROVIDER_NOT_CONFIGURED,
  AuthErrorCode.PUBLIC_SIGNUP_DISABLED,
  AuthErrorCode.OAUTH_TICKET_INVALID,
])
