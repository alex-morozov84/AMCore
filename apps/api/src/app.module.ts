import { createKeyv } from '@keyv/redis'
import { CacheModule } from '@nestjs/cache-manager'
import { Module, RequestMethod } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'

import { AppController } from './app.controller'
import { AuthModule } from './core/auth/auth.module'
import { HealthModule } from './health'
import { PrismaModule } from './prisma'
import { validate } from './env'
import { EnvModule } from './env/env.module'
import { EnvService } from './env/env.service'

@Module({
  imports: [
    // Environment variables (validated via Zod, typed Env)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      validate,
    }),

    EnvModule,

    // Logging
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
        autoLogging: true,
        quietReqLogger: true,
      },
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      exclude: [],
    }),

    // Cache (Redis)
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        stores: [createKeyv(env.get('REDIS_URL'))],
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

    // Auth module
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
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
  ],
})
export class AppModule {}
