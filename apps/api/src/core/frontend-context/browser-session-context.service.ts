import { timingSafeEqual } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { BROWSER_AUTH_HEADERS, type BrowserAudience, browserAudienceSchema } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import { type BrowserRequestBinding, browserRequestBinding } from '../auth/mfa/browser-binding.js'

interface VerifiedBrowserTransport {
  readonly audience: BrowserAudience
  readonly binding: BrowserRequestBinding | null
}
const verified = new WeakMap<object, VerifiedBrowserTransport>()

export function browserSessionContext(request: object): VerifiedBrowserTransport | undefined {
  return verified.get(request)
}

/** A private BFF transport proof; neither Origin nor an audience string authenticates a browser. */
@Injectable()
export class BrowserSessionContextService {
  constructor(private readonly env: EnvService) {}

  verify(request: object, headers: Record<string, string | string[] | undefined>): void {
    verified.delete(request)
    if (Object.values(BROWSER_AUTH_HEADERS).every((name) => headers[name] === undefined)) return
    const key = headers[BROWSER_AUTH_HEADERS.key]
    const expected = this.env.get('WEB_FRONTEND_CONTEXT_KEY')
    const audience = browserAudienceSchema.safeParse(headers[BROWSER_AUTH_HEADERS.audience])
    if (
      typeof key !== 'string' ||
      !expected ||
      !audience.success ||
      Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))
    ) {
      throw new ForbiddenException('Invalid browser context')
    }
    const names = [
      BROWSER_AUTH_HEADERS.binding,
      BROWSER_AUTH_HEADERS.contextId,
      BROWSER_AUTH_HEADERS.generation,
    ]
    const empty = names.every((name) => headers[name] === undefined)
    const generation = headers[BROWSER_AUTH_HEADERS.generation]
    const binding = empty
      ? null
      : browserRequestBinding(headers[BROWSER_AUTH_HEADERS.binding], audience.data, {
          contextId: headers[BROWSER_AUTH_HEADERS.contextId],
          generation:
            typeof generation === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(generation)
              ? Number(generation)
              : null,
        })
    if (!empty && !binding) throw new ForbiddenException('Invalid browser context')
    // Bootstrap is account-neutral and carries no binding or session authority.
    verified.set(request, Object.freeze({ audience: audience.data, binding }))
  }
}
