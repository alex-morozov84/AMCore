import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AvatarService } from '../avatar.service.js'

import { downloadAvatarSource, OAuthAvatarError } from './oauth-avatar-source.js'

/**
 * Copies an OAuth profile picture into our own storage once, so no third-party URL is ever
 * persisted or sent to a browser. It runs after the sign-in response is decided and never
 * throws: a failure leaves the user without an avatar and is not retried (the caller schedules the
 * copy only when the account is created or a provider is first linked).
 * It only fills an empty avatar, so it cannot replace one the user uploaded.
 */
@Injectable()
export class OAuthAvatarRehostService {
  constructor(
    private readonly avatars: AvatarService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(OAuthAvatarRehostService.name)
  }

  /** Start the copy without waiting for it. */
  schedule(userId: string, sourceUrl: string): void {
    void this.rehost(userId, sourceUrl)
  }

  async rehost(userId: string, sourceUrl: string): Promise<'stored' | 'skipped' | 'failed'> {
    try {
      const file = await downloadAvatarSource(sourceUrl)
      const url = await this.avatars.setAvatarIfAbsent(userId, file)
      this.logger.info({ userId, result: url ? 'stored' : 'skipped' }, 'oauth avatar rehost')
      return url ? 'stored' : 'skipped'
    } catch (error) {
      const failure = error instanceof OAuthAvatarError ? error.failure : 'processing_failed'
      this.logger.warn({ userId, result: 'failed', failure }, 'oauth avatar rehost')
      return 'failed'
    }
  }
}
