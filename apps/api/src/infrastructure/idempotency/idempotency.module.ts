import { Module } from '@nestjs/common'

import { IdempotencyInterceptor } from './idempotency.interceptor'
import { IdempotencyStoreService } from './idempotency-store.service'

@Module({
  providers: [IdempotencyStoreService, IdempotencyInterceptor],
  exports: [IdempotencyStoreService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
