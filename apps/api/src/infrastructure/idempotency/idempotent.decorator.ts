import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common'

import { IDEMPOTENCY_METADATA_KEY } from './idempotency.constants'
import { IdempotencyInterceptor } from './idempotency.interceptor'
import type { IdempotencyOptions } from './idempotency.types'

export const Idempotent = (options: IdempotencyOptions): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENCY_METADATA_KEY, options),
    UseInterceptors(IdempotencyInterceptor)
  )
