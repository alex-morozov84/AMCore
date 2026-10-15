import type { EnvResolved } from './derive-defaults'
import type { RefinementCtx } from './refinement-ctx'

// Storage: when the s3 driver is selected, credentials + target are mandatory.
// STORAGE_ENDPOINT stays optional (AWS derives it; non-AWS providers set it
// explicitly). STORAGE_REGION always has a default.
function storageRules(env: EnvResolved, ctx: RefinementCtx): void {
  if (env.STORAGE_DRIVER === 's3') {
    for (const key of [
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
      'STORAGE_REGION',
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when STORAGE_DRIVER is s3`,
        })
      }
    }
  }

  publicLocationRules(env, ctx)

  if (env.STORAGE_SIGNED_URL_DEFAULT_TTL > env.STORAGE_SIGNED_URL_MAX_TTL) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_SIGNED_URL_DEFAULT_TTL'],
      message: 'STORAGE_SIGNED_URL_DEFAULT_TTL must be <= STORAGE_SIGNED_URL_MAX_TTL',
    })
  }
}

// Public location: URLs are never synthesized, so a driver that serves public files
// needs the explicit base, and the presign endpoint must stay a bare S3 API origin
// (a CDN path there makes the SDK sign a wrong host and path).
function publicLocationRules(env: EnvResolved, ctx: RefinementCtx): void {
  if (env.STORAGE_DRIVER !== 'memory' && !env.STORAGE_PUBLIC_BASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_PUBLIC_BASE_URL'],
      message: `STORAGE_PUBLIC_BASE_URL is required when STORAGE_DRIVER is ${env.STORAGE_DRIVER}`,
    })
  }
  const base = parseUrl(env.STORAGE_PUBLIC_BASE_URL)
  if (base && (base.search || base.hash)) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_PUBLIC_BASE_URL'],
      message: 'STORAGE_PUBLIC_BASE_URL must not contain a query string or fragment',
    })
  }
  // An ACL can be accepted and silently ignored (measured on SeaweedFS and Garage), and only
  // the delivery check notices, so `acl` never runs without it.
  if (
    env.STORAGE_DRIVER === 's3' &&
    env.STORAGE_PUBLIC_DELIVERY === 'acl' &&
    !env.STORAGE_PUBLIC_CHECK_ENABLED
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_PUBLIC_CHECK_ENABLED'],
      message: 'STORAGE_PUBLIC_CHECK_ENABLED must be true when STORAGE_PUBLIC_DELIVERY is acl',
    })
  }
  const presign = parseUrl(env.STORAGE_PRESIGN_ENDPOINT)
  if (presign && (presign.pathname !== '/' || presign.search || presign.hash)) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_PRESIGN_ENDPOINT'],
      message:
        'STORAGE_PRESIGN_ENDPOINT must be a bare S3 API origin without a path; set the CDN or public base in STORAGE_PUBLIC_BASE_URL',
    })
  }
}

function parseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

// Media: per-preset and hard decode pixel caps must not exceed the global cap.
function mediaRules(env: EnvResolved, ctx: RefinementCtx): void {
  if (env.MEDIA_AVATAR_MAX_PIXELS > env.MEDIA_MAX_PIXELS) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIA_AVATAR_MAX_PIXELS'],
      message: 'MEDIA_AVATAR_MAX_PIXELS must be <= MEDIA_MAX_PIXELS',
    })
  }
  if (env.MEDIA_SHARP_LIMIT_INPUT_PIXELS > env.MEDIA_MAX_PIXELS) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIA_SHARP_LIMIT_INPUT_PIXELS'],
      message: 'MEDIA_SHARP_LIMIT_INPUT_PIXELS must be <= MEDIA_MAX_PIXELS',
    })
  }
}

// Database: production must connect over TLS (sslmode=require or verify-full).
function databaseRule(env: EnvResolved, ctx: RefinementCtx): void {
  if (env.NODE_ENV !== 'production') return

  let sslmode: string | null = null
  try {
    sslmode = new URL(env.DATABASE_URL).searchParams.get('sslmode')?.toLowerCase() ?? null
  } catch {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL must be a valid URL',
    })
    return
  }

  if (sslmode !== 'require' && sslmode !== 'verify-full') {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL must include sslmode=require or sslmode=verify-full in production',
    })
  }
}

// Storage/media/database resource cross-field rules.
export function resourceRules(env: EnvResolved, ctx: RefinementCtx): void {
  storageRules(env, ctx)
  mediaRules(env, ctx)
  databaseRule(env, ctx)
}
