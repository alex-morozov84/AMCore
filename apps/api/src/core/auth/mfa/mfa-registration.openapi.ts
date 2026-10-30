import { applyDecorators } from '@nestjs/common'
import { ApiHeader } from '@nestjs/swagger'

import { BROWSER_AUTH_HEADERS } from '@amcore/shared'

/** Optional native compatibility; the private BFF supplies the complete set together. */
export function ApiRegistrationPublication(): ReturnType<typeof applyDecorators> {
  const headers = [
    [BROWSER_AUTH_HEADERS.key, 'Private BFF proof. Never send from browser JavaScript.'],
    [BROWSER_AUTH_HEADERS.audience, 'Server-selected browser audience.'],
    [BROWSER_AUTH_HEADERS.binding, 'Actual HttpOnly browser anchor, carried only by the BFF.'],
    [BROWSER_AUTH_HEADERS.contextId, 'Exact current browser context.'],
    [BROWSER_AUTH_HEADERS.generation, 'Exact current browser generation before account creation.'],
    [
      'X-Mfa-Continuation',
      'Private proposed continuation retained by the BFF before registration.',
    ],
    ['X-Mfa-Vault-Binding', 'Private proposed vault binding retained before registration.'],
    ['X-Amcore-Login-Attempt', 'Exact preselected registration operation UUID.'],
  ]
  return applyDecorators(
    ...headers.map(([name, description]) =>
      ApiHeader({
        name: name!,
        description,
        required: false,
        schema: { type: 'string' },
      })
    )
  )
}
