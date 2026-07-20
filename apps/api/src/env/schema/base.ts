import { z } from 'zod'

import { aiEnv } from './ai.env'
import { authEnv } from './auth.env'
import { databaseEnv } from './database.env'
import { emailEnv } from './email.env'
import { idempotencyEnv } from './idempotency.env'
import { mediaEnv } from './media.env'
import { oauthEnv } from './oauth.env'
import { observabilityEnv } from './observability.env'
import { queueEnv } from './queue.env'
import { aiRealtimeEnv, notificationsRealtimeEnv } from './realtime.env'
import { redisEnv } from './redis.env'
import { runtimeEnv } from './runtime.env'
import { storageEnv } from './storage.env'
import { telegramEnv } from './telegram.env'
import { webhooksEnv } from './webhooks.env'

// Domain sections, kept as pure `ZodObject`s so their `.shape` composes and stays
// introspectable (the `.env.example` coverage guard reads `envBaseSchema.shape`).
// `env-sections.spec.ts` asserts these have no overlapping keys (spread is
// last-wins, so a silent collision would otherwise be undetectable).
export const envSections = {
  runtime: runtimeEnv,
  database: databaseEnv,
  redis: redisEnv,
  observability: observabilityEnv,
  idempotency: idempotencyEnv,
  webhooks: webhooksEnv,
  notificationsRealtime: notificationsRealtimeEnv,
  aiRealtime: aiRealtimeEnv,
  queue: queueEnv,
  auth: authEnv,
  oauth: oauthEnv,
  telegram: telegramEnv,
  email: emailEnv,
  storage: storageEnv,
  media: mediaEnv,
  ai: aiEnv,
} as const

// One flat object — env vars stay flat; only their definitions are organized. The
// typed spread preserves precise per-key inference for `Env`.
export const envBaseSchema = z.object({
  ...runtimeEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
  ...observabilityEnv.shape,
  ...idempotencyEnv.shape,
  ...webhooksEnv.shape,
  ...notificationsRealtimeEnv.shape,
  ...aiRealtimeEnv.shape,
  ...queueEnv.shape,
  ...authEnv.shape,
  ...oauthEnv.shape,
  ...telegramEnv.shape,
  ...emailEnv.shape,
  ...storageEnv.shape,
  ...mediaEnv.shape,
  ...aiEnv.shape,
})

export type EnvInput = z.infer<typeof envBaseSchema>
