import KeyvRedis from '@keyv/redis'
import { CacheModule } from '@nestjs/cache-manager'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { Request } from 'express'
import { ClsModule, ClsService } from 'nestjs-cls'
import { LoggerModule } from 'nestjs-pino'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { v4 as uuidv4 } from 'uuid'

import { AppController } from './app.controller'
import { createLoggingConfig } from './common/config'
import {
  AllExceptionsFilter,
  HttpExceptionFilter,
  PrismaClientExceptionFilter,
} from './common/exceptions/filters'
import { anonymizeIp, getClientIp } from './common/utils'
import { AdminModule } from './core/admin/admin.module'
import { AuthModule } from './core/auth/auth.module'
import { OrganizationsModule } from './core/organizations/organizations.module'
import { validate } from './env'
import { EnvModule } from './env/env.module'
import { EnvService } from './env/env.service'
import { HealthModule } from './health'
import { EmailModule } from './infrastructure/email'
import { QueueModule } from './infrastructure/queue'
import { PrismaModule } from './prisma'
import { ShutdownService } from './shutdown.service'

@Module({
  imports: [
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
      inject: [ClsService],
      useFactory: createLoggingConfig,
    }),

    // Cache (Redis)
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        stores: [new KeyvRedis(env.get('REDIS_URL'))],
        ttl: 60 * 1000, // 60 seconds default
      }),
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // 10 requests per second
      },
      {
        name: 'long',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),

    // Database
    PrismaModule,

    // Health check
    HealthModule,

    // Queue infrastructure
    QueueModule,

    // Email infrastructure
    EmailModule,

    // Auth module
    AuthModule,

    // Core: Organizations, Roles & Permissions
    OrganizationsModule,

    // Core: Admin (SUPER_ADMIN only)
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    // Exception filters (order matters - registered first = applied last)
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter, // Catch-all (last resort)
    },
    {
      provide: APP_FILTER,
      useClass: PrismaClientExceptionFilter, // Prisma-specific errors
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter, // Standard HTTP exceptions
    },

    // Zod validation pipe (auto-validates DTOs)
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    // Zod serializer (auto-validates responses)
    {
      provide: APP_INTERCEPTOR,
      useClass: ZodSerializerInterceptor,
    },
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    ShutdownService,
  ],
})
export class AppModule {}
