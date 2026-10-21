import { applyDecorators } from '@nestjs/common'
import { ApiHeader, ApiResponse } from '@nestjs/swagger'

export function ApiFrontendContext(): ReturnType<typeof applyDecorators> {
  return applyDecorators(
    ApiHeader({
      name: 'X-Amcore-Web-Frontend',
      required: false,
      enum: ['site', 'admin'],
      description:
        'Trusted web hop only. All three context headers are required together; absent means native/site compatibility.',
    }),
    ApiHeader({
      name: 'X-Amcore-Web-Placement',
      required: false,
      description: 'Trusted web placement SHA-256 fingerprint; never a user permission.',
    }),
    ApiHeader({
      name: 'X-Amcore-Web-Context-Key',
      required: false,
      description: 'Confidential API/web hop proof. Never send from browser JavaScript.',
    }),
    ApiResponse({
      status: 403,
      description: 'Invalid or incomplete frontend proof; no auth effects',
    }),
    ApiResponse({ status: 503, description: 'API/web placement disagreement; no auth effects' })
  )
}
