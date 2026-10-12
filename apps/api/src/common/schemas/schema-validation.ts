import { HttpException, StandardSchemaValidationPipe } from '@nestjs/common'
import type { z } from 'zod'

type Issues = Parameters<
  NonNullable<
    NonNullable<ConstructorParameters<typeof StandardSchemaValidationPipe>[0]>['exceptionFactory']
  >
>[0]

/** Only transport fields survive; schema input and nested error objects never do. */
export function validationException(issues: Issues): HttpException {
  return new HttpException(
    {
      statusCode: 400,
      message: 'Validation failed',
      errors: issues.map((issue) => {
        const extended = issue as typeof issue & { code?: string; params?: { errorCode?: string } }
        return {
          path: issue.path?.map((part) => (typeof part === 'object' ? part.key : part)) ?? [],
          message: issue.message,
          code: extended.code,
          params:
            typeof extended.params?.errorCode === 'string'
              ? { errorCode: extended.params.errorCode }
              : undefined,
        }
      }),
    },
    400
  )
}

export class SchemaValidationException extends HttpException {
  constructor(error: z.ZodError) {
    super(validationException(error.issues).getResponse(), 400)
  }
}

export function createSchemaValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({ exceptionFactory: validationException })
}
