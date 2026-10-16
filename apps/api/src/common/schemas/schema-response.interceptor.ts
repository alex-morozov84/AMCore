import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { mergeMap } from 'rxjs'
import type { z } from 'zod'

import { AppException } from '../exceptions/domain/app.exception.js'

import { RESPONSE_SCHEMA } from './schema-response.js'

/** Validate the entire response, including arrays, primitives and null. */
@Injectable()
export class SchemaResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const schema = this.reflector.getAllAndOverride<z.ZodType | undefined>(RESPONSE_SCHEMA, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!schema) return next.handle()
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        try {
          return await schema.parseAsync(value)
        } catch {
          throw new AppException(
            'Response validation failed',
            HttpStatus.INTERNAL_SERVER_ERROR,
            'INTERNAL_ERROR'
          )
        }
      })
    )
  }
}
