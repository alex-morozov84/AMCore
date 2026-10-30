import type { ModuleMetadata, Provider } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import type { Request, Response } from 'express'
import { ClsModule, ClsService } from 'nestjs-cls'
import { LoggerModule } from 'nestjs-pino'
import { v4 as uuidv4 } from 'uuid'

import { BACKGROUND_WORK } from './background-work.composition.js'
import { createLoggingConfig } from './common/config/index.js'
import {
  AllExceptionsFilter,
  HttpExceptionFilter,
  PrismaClientExceptionFilter,
} from './common/exceptions/filters/index.js'
import { SchemaResponseInterceptor } from './common/schemas/schema-response.interceptor.js'
import { createSchemaValidationPipe } from './common/schemas/schema-validation.js'
import {
  anonymizeIp,
  CORRELATION_ID_HEADER,
  getClientIp,
  pickCorrelationId,
} from './common/utils/index.js'
import { AdminModule } from './core/admin/admin.module.js'
import { AiWebModule } from './core/ai/ai-web.module.js'
import { AuthModule } from './core/auth/auth.module.js'
import { NotificationsModule } from './core/notifications/notifications.module.js'
import { NotificationsWebModule } from './core/notifications/notifications-web.module.js'
import { OrganizationsModule } from './core/organizations/organizations.module.js'
import { envConfigOptions } from './env/env.config.js'
import { EnvModule } from './env/env.module.js'
import { EnvService } from './env/env.service.js'
import { HealthModule } from './health/index.js'
import { AiCatalogModule } from './infrastructure/ai/ai-catalog.module.js'
import {
  composeBackgroundWork,
  type WorkProcessRole,
} from './infrastructure/background-work/compose-background-work.js'
import type { WorkRegistration } from './infrastructure/background-work/work-definition.js'
import { EmailModule } from './infrastructure/email/email.module.js'
import { IdempotencyModule } from './infrastructure/idempotency/index.js'
import { ObservabilityModule } from './infrastructure/observability/index.js'
import { BullBoardHttpModule } from './infrastructure/queue/dashboard/bull-board-http.module.js'
import { QueueModule } from './infrastructure/queue/index.js'
import { RedisModule } from './infrastructure/redis/index.js'
import { ScheduleModule } from './infrastructure/schedule/schedule.module.js'
import { SettingsModule } from './infrastructure/settings/settings.module.js'
import { StorageModule, StoragePublicModule } from './infrastructure/storage/index.js'
import { ThrottlingModule } from './infrastructure/throttling/index.js'
import { WebhooksModule } from './infrastructure/webhooks/index.js'
import { PrismaModule } from './prisma/index.js'
import { ShutdownService } from './shutdown.service.js'

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
export function coreImports(
  role: WorkProcessRole = 'web',
  entries: readonly WorkRegistration[] = BACKGROUND_WORK
): Imports {
  return [
    // Environment variables (validated via Zod, typed Env)
    ConfigModule.forRoot(envConfigOptions),

    EnvModule,

    // Correlation ID (CLS - Continuation Local Storage)
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => {
          // Priority: load balancer → upstream → generate new. Only a well-formed value is
          // accepted: the ID is a log-store search key and a queued-job field.
          return pickCorrelationId(
            [req.headers['x-request-id'], req.headers['x-correlation-id']],
            uuidv4
          )
        },
        setup: (cls, req: Request & { user?: { sub: string } }, res: Response) => {
          // Echo the ID so an operator can search the logs for a successful request too.
          res.setHeader(CORRELATION_ID_HEADER, cls.getId())

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

    // Shared Redis client plus the abuse-counter store and bounded-call helper.
    // There is no general cache layer: each consumer uses the Redis commands it needs.
    RedisModule,

    // Rate limiting (GCRA, Option O — ADR-039/ADR-073). Registration, the
    // Redis-backed limiter, the global guard, and the @RateLimit/
    // @SkipRateLimit decorators all live inside ThrottlingModule. Imported
    // ahead of AuthModule (webImports) so RateLimitGuard runs before
    // AuthenticationGuard.
    ThrottlingModule,

    // Database
    PrismaModule,
    SettingsModule,

    // Health check (served by every role; the worker's only HTTP surface)
    HealthModule,

    // Queue infrastructure — producers (registerQueue) + the BullMQ connection.
    // EmailWorkerModule supplies handlers/policy; the registry generates worker/all hosts.
    composeBackgroundWork(entries, role),
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
    NotificationsModule,

    // AI catalog registry (Track C — ADR-054). The web-safe half of the AI engine:
    // the secret-free model registry only. The provider-call seam (ModelGateway +
    // adapters) lives in the worker-only AiGatewayModule (wired in Arc C.4), so the
    // web DI graph never gains provider-call capability.
    AiCatalogModule,
  ]
}

/** Business HTTP modules — `web` and `all` only. */
export const webImports: Imports = [
  BullBoardHttpModule,
  StoragePublicModule,
  // Auth
  AuthModule,
  // Core: Organizations, Roles & Permissions
  OrganizationsModule,
  // Core: Admin (SUPER_ADMIN only)
  AdminModule,
  // Notifications HTTP feed (producer/registry come from NotificationsModule).
  NotificationsWebModule,
  // AI conversation + durable-run producer/read HTTP surface (Track C — ADR-054).
  AiWebModule,
]

/**
 * Background work — `worker` and `all` only: the BullMQ email consumer and the
 * scheduler (`NestScheduleModule.forRoot()` lives in ScheduleModule, so `@Cron`
 * jobs only register here).
 */
export function workerImports(): Imports {
  return [
    import('./core/auth/mfa/mfa-maintenance.module.js').then(({ MfaMaintenanceModule }) => ({
      module: MfaMaintenanceModule,
    })),
    import('./core/admin/background-control-worker.module.js').then(
      ({ BackgroundControlWorkerModule }) => ({ module: BackgroundControlWorkerModule })
    ),
    import('./infrastructure/queue/queue-metrics.module.js').then(({ QueueMetricsModule }) => ({
      module: QueueMetricsModule,
    })),
    ScheduleModule,
  ]
}

/** Global filters/pipe/interceptor/guard + shutdown — every role. */
export const appProviders: Provider[] = [
  // Exception filters (order matters - registered first = applied last)
  { provide: APP_FILTER, useClass: AllExceptionsFilter }, // Catch-all (last resort)
  { provide: APP_FILTER, useClass: PrismaClientExceptionFilter }, // Prisma-specific errors
  { provide: APP_FILTER, useClass: HttpExceptionFilter }, // Standard HTTP exceptions
  // Native validation reads explicit parameter schema metadata.
  { provide: APP_PIPE, useFactory: createSchemaValidationPipe },
  // Validate whole responses declared by SchemaResponse.
  { provide: APP_INTERCEPTOR, useClass: SchemaResponseInterceptor },
  // Rate limiting's global guard (RateLimitGuard) is registered inside
  // ThrottlingModule itself, not here — see its own module doc.
  ShutdownService,
]
