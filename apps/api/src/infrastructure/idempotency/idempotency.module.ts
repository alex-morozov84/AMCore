import { Module } from '@nestjs/common'

import { IdempotencyInterceptor } from './idempotency.interceptor.js'
import { IdempotencyStoreService } from './idempotency-store.service.js'

@Module({
  providers: [IdempotencyStoreService, IdempotencyInterceptor],
  exports: [IdempotencyStoreService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
