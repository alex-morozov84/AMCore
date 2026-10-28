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

import { RESPONSE_SCHEMA, RESPONSE_SCHEMAS_BY_STATUS } from './schema-response.js'

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
    const variants = this.reflector.getAllAndOverride<
      Array<{ status: number; schema: z.ZodType }> | undefined
    >(RESPONSE_SCHEMAS_BY_STATUS, [context.getHandler(), context.getClass()])
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        try {
          // Read status after the handler runs: a passthrough response may select a pending outcome.
          const selected = Array.isArray(variants)
            ? variants.find(
                (variant) =>
                  variant.status ===
                  context.switchToHttp().getResponse<{ statusCode: number }>().statusCode
              )?.schema
            : schema
          if (!selected) throw new Error('Undeclared response status')
          return await selected.parseAsync(value)
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
