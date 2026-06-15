import KeyvRedis from '@keyv/redis'
import { CacheModule } from '@nestjs/cache-manager'
import type { ModuleMetadata, Provider } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { Request } from 'express'
import { ClsModule, ClsService } from 'nestjs-cls'
import { LoggerModule } from 'nestjs-pino'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { v4 as uuidv4 } from 'uuid'

import { createLoggingConfig } from './common/config'
import {
  AllExceptionsFilter,
  HttpExceptionFilter,
  PrismaClientExceptionFilter,
} from './common/exceptions/filters'
import { anonymizeIp, getClientIp } from './common/utils'
import { AdminModule } from './core/admin/admin.module'
import { AuthModule } from './core/auth/auth.module'
import { NotificationsCoreModule } from './core/notifications/notifications-core.module'
import { OrganizationsModule } from './core/organizations/organizations.module'
import { validate } from './env'
import { EnvModule } from './env/env.module'
import { EnvService } from './env/env.service'
import { HealthModule } from './health'
import { EmailModule, EmailWorkerModule } from './infrastructure/email'
import { IdempotencyModule } from './infrastructure/idempotency'
import { ObservabilityModule } from './infrastructure/observability'
import { QueueMetricsModule, QueueModule } from './infrastructure/queue'
import { type AppRedisClient, REDIS_CLIENT, RedisModule } from './infrastructure/redis'
import { ScheduleModule } from './infrastructure/schedule/schedule.module'
import { StorageModule } from './infrastructure/storage'
import { RedisThrottlerStorage, ThrottlingModule } from './infrastructure/throttling'
import { WebhooksModule } from './infrastructure/webhooks'
import { PrismaModule } from './prisma'
import { ShutdownService } from './shutdown.service'

type Imports = NonNullable<ModuleMetadata['imports']>

/**
 * Process-role module composition (ADR-041). The three roots — `AppModule`
 * (`all`), `WebModule`, `WorkerModule` — share `coreImports()` and add the web
 * and/or worker slices. `coreImports()` is a function so each root gets fresh
 * dynamic-module descriptors; only the root the bootstrap selects is instantiated.
 */

/**
 * Infrastructure needed by every role: config/env, CLS, logging, Redis, cache,
 * the Redis-backed throttler, Prisma, health, queue *producers*, the email
 * *producer* (`EmailService`), and storage. No business controllers, no BullMQ
 * worker, no scheduler.
 */
export function coreImports(): Imports {
  return [
    // Environment variables (validated via Zod, typed Env)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      validate,
    }),

    EnvModule,

    // Correlation ID (CLS - Continuation Local Storage)
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => {
          // Priority: load balancer → upstream → generate new
          return (req.headers['x-request-id'] ||
            req.headers['x-correlation-id'] ||
            uuidv4()) as string
        },
        setup: (cls, req: Request & { user?: { sub: string } }) => {
          // Auto-inject userId from JWT (if authenticated). user.sub = userId (RequestPrincipal)
          if (req.user?.sub) {
            cls.set('userId', req.user.sub)
          }

          // Store anonymized IP (GDPR compliant)
          const clientIp = getClientIp(req)
          const anonymizedIp = anonymizeIp(clientIp)
          if (anonymizedIp) {
            cls.set('ip', anonymizedIp)
          }

          // Store user agent for debugging/analytics
          const userAgent = req.headers['user-agent']
          if (userAgent) {
            cls.set('userAgent', userAgent)
          }
        },
      },
    }),

    // Logging (with correlation ID from CLS)
    LoggerModule.forRootAsync({
      inject: [ClsService, EnvService],
      useFactory: (cls: ClsService, env: EnvService) =>
        createLoggingConfig(cls, env.get('LOG_BODY_MAX_BYTES')),
    }),

    // Metrics/tracing foundation (ADR-042). Provides /metrics and an internal
    // metrics service for bounded, low-cardinality instrumentation.
    ObservabilityModule,

    RedisModule,

    // Cache (Redis)
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redisClient: AppRedisClient) => ({
        // RedisConnectionService opens the shared client during Nest init; KeyvRedis defers
        // commands until first cache operation, after providers have initialized.
        stores: [new KeyvRedis(redisClient)],
        ttl: 60 * 1000, // 60 seconds default
      }),
    }),

    // Rate limiting (Redis-backed global throttler — ADR-039)
    //
    // Storage is Redis-backed via RedisThrottlerStorage so the short/long
    // limits are shared across API replicas instead of being process-local.
    //
    // OB-03 note: privileged admin operations override the `long` bucket
    // per-handler via `@Throttle({ long: { ... } })` rather than registering a
    // third global named throttler — a third named throttler here would apply
    // its default limit to every route.
    ThrottlerModule.forRootAsync({
      imports: [ThrottlingModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [
          { name: 'short', ttl: 1000, limit: 10 }, // 10 requests per second
          { name: 'long', ttl: 60000, limit: 100 }, // 100 requests per minute
        ],
        storage,
      }),
    }),

    // Database
    PrismaModule,

    // Health check (served by every role; the worker's only HTTP surface)
    HealthModule,

    // Queue infrastructure — producers (registerQueue) + the BullMQ connection.
    // The consumer (EmailProcessor) lives in EmailWorkerModule (worker/all only).
    QueueModule,

    // Email producer (EmailService). The processor is EmailWorkerModule.
    EmailModule,

    // Storage infrastructure (driver selected by STORAGE_DRIVER) — also the
    // StorageHealthIndicator the health controller injects.
    StorageModule.forRoot(),

    // Inbound webhook verification primitives (ADR-044).
    WebhooksModule,

    // HTTP idempotency primitive (ADR-043).
    IdempotencyModule,

    // Notifications producer + definition registry/preferences (ADR-052). The
    // in-app producer is core; controllers (web) and dispatcher/realtime (worker)
    // are added in later arcs.
    NotificationsCoreModule,
  ]
}

/** Business HTTP modules — `web` and `all` only. */
export const webImports: Imports = [
  // Auth
  AuthModule,
  // Core: Organizations, Roles & Permissions
  OrganizationsModule,
  // Core: Admin (SUPER_ADMIN only)
  AdminModule,
]

/**
 * Background work — `worker` and `all` only: the BullMQ email consumer and the
 * scheduler (`NestScheduleModule.forRoot()` lives in ScheduleModule, so `@Cron`
 * jobs only register here).
 */
export const workerImports: Imports = [EmailWorkerModule, QueueMetricsModule, ScheduleModule]

/** Global filters/pipe/interceptor/guard + shutdown — every role. */
export const appProviders: Provider[] = [
  // Exception filters (order matters - registered first = applied last)
  { provide: APP_FILTER, useClass: AllExceptionsFilter }, // Catch-all (last resort)
  { provide: APP_FILTER, useClass: PrismaClientExceptionFilter }, // Prisma-specific errors
  { provide: APP_FILTER, useClass: HttpExceptionFilter }, // Standard HTTP exceptions
  // Zod validation pipe (auto-validates DTOs)
  { provide: APP_PIPE, useClass: ZodValidationPipe },
  // Zod serializer (auto-validates responses)
  { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  // Apply rate limiting globally
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  ShutdownService,
]
