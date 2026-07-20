import { TELEGRAM_WEBHOOK_SECRET_PATTERN } from '../../../core/notifications/channels/telegram/telegram.constants'

import type { EnvResolved } from './derive-defaults'
import type { RefinementCtx } from './refinement-ctx'

// When any key of a provider group is set, all of them are required.
function requireAllIfAny(
  env: EnvResolved,
  ctx: RefinementCtx,
  groupName: string,
  keys: Array<keyof EnvResolved>
): void {
  if (!keys.some((key) => env[key] !== undefined)) return
  for (const key of keys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${String(key)} is required when configuring ${groupName}`,
      })
    }
  }
}

function oauthRules(env: EnvResolved, ctx: RefinementCtx): void {
  requireAllIfAny(env, ctx, 'Google OAuth', [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
  ])
  requireAllIfAny(env, ctx, 'GitHub OAuth', [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_CALLBACK_URL',
  ])
  requireAllIfAny(env, ctx, 'Apple OAuth', [
    'APPLE_CLIENT_ID',
    'APPLE_TEAM_ID',
    'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY',
    'APPLE_CALLBACK_URL',
  ])
}

// Telegram OAuth login: a callback URL requires a token, but a token alone does NOT
// force a callback (token-only / channel-only is valid).
function telegramCallbackRule(env: EnvResolved, ctx: RefinementCtx): void {
  if (env.TELEGRAM_CALLBACK_URL !== undefined && env.TELEGRAM_BOT_TOKEN === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_BOT_TOKEN'],
      message: 'TELEGRAM_BOT_TOKEN is required when TELEGRAM_CALLBACK_URL is set',
    })
  }
}

// Telegram webhook secret grammar (Arc D): validate the official `setWebhook`
// secret_token grammar/length when present so a malformed secret fails at config
// load, not at the first webhook.
function telegramWebhookSecretGrammarRule(env: EnvResolved, ctx: RefinementCtx): void {
  const secret = env.WEBHOOK_SECRETS.telegram
  if (secret !== undefined && !TELEGRAM_WEBHOOK_SECRET_PATTERN.test(secret)) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBHOOK_SECRETS', 'telegram'],
      message: 'WEBHOOK_TELEGRAM_SECRET must be 1–256 characters of A-Za-z0-9_-',
    })
  }
}

// Telegram notifications channel (Arc D, corr. F / R3): channel-gated, NOT a flat
// requireAllIfAny over the token. The channel is *enabled* iff a channel-specific
// field is present (bot username OR webhook secret); when enabled, require the full
// trio (token + username + secret). So TELEGRAM_BOT_TOKEN alone stays valid.
function telegramChannelRule(env: EnvResolved, ctx: RefinementCtx): void {
  const secret = env.WEBHOOK_SECRETS.telegram
  const enabled = env.TELEGRAM_BOT_USERNAME !== undefined || secret !== undefined
  if (!enabled) return
  const suffix = 'when the Telegram notifications channel is enabled'
  if (env.TELEGRAM_BOT_TOKEN === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_BOT_TOKEN'],
      message: `TELEGRAM_BOT_TOKEN is required ${suffix}`,
    })
  }
  if (env.TELEGRAM_BOT_USERNAME === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_BOT_USERNAME'],
      message: `TELEGRAM_BOT_USERNAME is required ${suffix}`,
    })
  }
  if (secret === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBHOOK_SECRETS', 'telegram'],
      message: `WEBHOOK_TELEGRAM_SECRET is required ${suffix}`,
    })
  }
}

function emailRule(env: EnvResolved, ctx: RefinementCtx): void {
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message: 'RESEND_API_KEY is required when EMAIL_PROVIDER is resend',
    })
  }
}

// Auth/notification provider cross-field rules.
export function providerRules(env: EnvResolved, ctx: RefinementCtx): void {
  oauthRules(env, ctx)
  telegramCallbackRule(env, ctx)
  telegramWebhookSecretGrammarRule(env, ctx)
  telegramChannelRule(env, ctx)
  emailRule(env, ctx)
}
