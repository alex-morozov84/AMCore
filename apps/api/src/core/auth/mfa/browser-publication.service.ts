import { Injectable } from '@nestjs/common'

import {
  AuthErrorCode,
  type BrowserAudience,
  type BrowserBindingProbeInput,
  browserBindingProbeInputSchema,
  type BrowserBindingProbeResult,
  browserBindingProbeResultSchema,
  type BrowserBootstrapResult,
  type BrowserContextView,
  browserContextViewSchema,
} from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { BrowserAuthContext } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'
import { hashRefreshToken } from '../utils/refresh-token-hash.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { bootstrapBrowserContext, readBrowserContext } from './browser-context.repository.js'
import { renewExpiredBrowserContext } from './browser-context-renewal.js'
import { MfaAuthorityReader } from './mfa-authority-reader.service.js'
import { readMfaPrimaryProjection } from './mfa-primary-projection.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export function browserContextChanged(): AppException {
  return new AppException(
    'Browser authentication context changed',
    401,
    AuthErrorCode.AUTH_CONTEXT_CHANGED
  )
}

/** Private BFF transport only. An anchor alone reveals no account; a probe cannot refresh or publish credentials. */
@Injectable()
export class BrowserPublicationService {
  constructor(
    private readonly db: PrismaService,
    private readonly sourceLimiter: MfaSourceLimiterService
  ) {}

  async bootstrap(
    audience: BrowserAudience,
    existingBinding: string | undefined,
    source: string
  ): Promise<BrowserBootstrapResult> {
    if (existingBinding) {
      const current = await readBrowserContext(this.db, existingBinding, audience)
      if (current && current.expiresAt > (await mfaDatabaseClock(this.db)))
        return { kind: 'existing', view: this.view(current) }
      if (current) {
        await this.sourceLimiter.consume('start', source)
        const renewed = await renewExpiredBrowserContext(this.db, existingBinding, audience)
        return { kind: 'existing', view: this.view(renewed) }
      }
    }
    await this.sourceLimiter.consume('start', source)
    return { kind: 'created', ...(await bootstrapBrowserContext(this.db, audience)) }
  }

  async status(audience: BrowserAudience, binding: string): Promise<BrowserContextView> {
    const context = await readBrowserContext(this.db, binding, audience)
    if (!context || context.expiresAt <= (await mfaDatabaseClock(this.db)))
      throw browserContextChanged()
    return this.view(context)
  }

  async probe(
    raw: BrowserBindingProbeInput,
    binding: BrowserRequestBinding | null
  ): Promise<BrowserBindingProbeResult> {
    const input = browserBindingProbeInputSchema.parse(raw)
    if (!binding) throw browserContextChanged()
    try {
      return await this.db.$transaction(
        async (tx) => {
          const projection = await readMfaPrimaryProjection(tx, {
            refreshHash: hashRefreshToken(input.refreshToken),
            familyId: input.familyId,
          })
          const session = projection?.session,
            family = projection?.family,
            user = projection?.user
          if (
            !projection ||
            !session ||
            !family ||
            !user ||
            session.expiresAt <= projection.now ||
            session.familyId !== input.familyId ||
            (session.revokedAt !== null && session.revocationReason !== 'rotated') ||
            family.userId !== session.userId ||
            family.securityVersion !== input.securityVersion ||
            family.browserContextId !== binding.contextId ||
            family.publicationGeneration !== binding.generation
          )
            throw browserContextChanged()
          const admission = new MfaAuthorityReader(tx).admitProjection(
            projection,
            {
              sub: session.userId,
              email: '',
              systemRole: user.systemRole,
              sid: session.id,
              fid: family.id,
              securityVersion: family.securityVersion,
              browserBound: true,
            },
            binding
          )
          if (admission.kind === 'denied') {
            if (admission.reason === 'enforcement_unavailable')
              throw new ServiceUnavailableException('Browser admission unavailable')
            throw browserContextChanged()
          }
          return browserBindingProbeResultSchema.parse({
            status: 'current',
            userId: session.userId,
            familyId: family.id,
            securityVersion: family.securityVersion,
            contextId: binding.contextId,
            generation: binding.generation,
            audience: binding.audience,
          })
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof AppException) throw error
      throw new ServiceUnavailableException('Browser session verification unavailable')
    }
  }

  private view(context: BrowserAuthContext): BrowserContextView {
    return browserContextViewSchema.parse({
      contextId: context.id,
      generation: context.generation,
      state: context.state,
      expiresAt: context.expiresAt.toISOString(),
    })
  }
}
