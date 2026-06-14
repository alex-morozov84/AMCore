// Constants public API

// Auth error codes (machine-readable, frontend translates via next-intl)
export enum AuthErrorCode {
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  PHONE_ALREADY_EXISTS = 'PHONE_ALREADY_EXISTS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_INVALID = 'TOKEN_INVALID',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  AUTH_ORIGIN_REJECTED = 'AUTH_ORIGIN_REJECTED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  OAUTH_STATE_INVALID = 'OAUTH_STATE_INVALID',
  OAUTH_PROVIDER_ERROR = 'OAUTH_PROVIDER_ERROR',
  OAUTH_EMAIL_REQUIRED = 'OAUTH_EMAIL_REQUIRED',
  OAUTH_PROVIDER_NOT_CONFIGURED = 'OAUTH_PROVIDER_NOT_CONFIGURED',
  OAUTH_ACCOUNT_ALREADY_LINKED = 'OAUTH_ACCOUNT_ALREADY_LINKED',
  OAUTH_TICKET_INVALID = 'OAUTH_TICKET_INVALID',
  // OB-06b / ADR-037 step-up. STEP_UP_REQUIRED is returned with 403 on a
  // @RequireFreshAuth route (or /auth/step-up) when the session's recent-auth
  // is missing/stale; the client re-verifies via POST /auth/step-up.
  // STEP_UP_METHOD_UNAVAILABLE (403) means the account has no password
  // (OAuth-only) so password step-up is impossible — factor step-up is future MFA.
  STEP_UP_REQUIRED = 'STEP_UP_REQUIRED',
  STEP_UP_METHOD_UNAVAILABLE = 'STEP_UP_METHOD_UNAVAILABLE',
}

// Resource error codes (machine-readable, used across modules for DB-conflict cases)
export enum ResourceErrorCode {
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  API_KEY_ALREADY_EXISTS = 'API_KEY_ALREADY_EXISTS',
}

// Infrastructure error codes — transient backend failures the client may retry
// after a short backoff. Map to 503 Service Unavailable + Retry-After.
export enum InfrastructureErrorCode {
  DATABASE_POOL_TIMEOUT = 'DATABASE_POOL_TIMEOUT',
}

// API-key scope grammar error codes (AK-05).
// Returned per-scope in `errors[].errorCode` on POST /api-keys when the
// scope string fails schema validation. Frontend localizes via next-intl
// keyed on the code; raw API consumers can fall back to `message`.
export enum ApiKeyScopeErrorCode {
  API_KEY_SCOPE_INVALID_FORMAT = 'API_KEY_SCOPE_INVALID_FORMAT',
  API_KEY_SCOPE_UNKNOWN_ACTION = 'API_KEY_SCOPE_UNKNOWN_ACTION',
  API_KEY_SCOPE_UNKNOWN_SUBJECT = 'API_KEY_SCOPE_UNKNOWN_SUBJECT',
  API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN = 'API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN',
}

// Invite flow error codes (OB-02).
//
// `INVITE_INVALID_OR_EXPIRED` is deliberately umbrella — token not
// found, expired, revoked, already accepted, or email mismatch all
// collapse to one code with one generic message. The accept side must
// be non-enumerating for invite-token guesses; distinguishing the
// underlying state would let an attacker probe a stolen token to learn
// "the invite exists but is for someone else" vs "no such invite".
export enum InviteErrorCode {
  INVITE_INVALID_OR_EXPIRED = 'INVITE_INVALID_OR_EXPIRED',
  INVITE_ALREADY_MEMBER = 'INVITE_ALREADY_MEMBER',
  INVITE_EMAIL_NOT_VERIFIED = 'INVITE_EMAIL_NOT_VERIFIED',
}

// HTTP Status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const

// Auth constants
export const AUTH = {
  ACCESS_TOKEN_EXPIRES: '15m',
  REFRESH_TOKEN_EXPIRES: '7d',
  COOKIE_NAME: 'refresh_token',
} as const

// Supported UI/email locales — single source of truth for every locale contract
// (registration input, profile update, user response, email rendering). Adding a
// locale here is the only place to extend the set; downstream Zod schemas and the
// email `Locale` type derive from it. `DEFAULT_LOCALE` mirrors the Prisma
// `User.locale` column default.
export const SUPPORTED_LOCALES = ['ru', 'en'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'ru'
