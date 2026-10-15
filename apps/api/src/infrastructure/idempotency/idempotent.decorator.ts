import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common'

import { IDEMPOTENCY_METADATA_KEY } from './idempotency.constants.js'
import { IdempotencyInterceptor } from './idempotency.interceptor.js'
import type { IdempotencyOptions } from './idempotency.types.js'

export const Idempotent = (options: IdempotencyOptions): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENCY_METADATA_KEY, options),
    UseInterceptors(IdempotencyInterceptor)
  )
