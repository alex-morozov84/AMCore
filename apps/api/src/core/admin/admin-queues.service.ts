import { Injectable } from '@nestjs/common'

import type { AdminQueuesResponse } from '@amcore/shared'

import { QueueObservationService } from '@/infrastructure/queue'

/**
 * Console Background work summary. A failing row is typed `unavailable` data inside a 200,
 * never zeros and never an HTTP 5xx, so the Console can tell "Redis could not be read" from
 * "this endpoint could not be reached".
 */
@Injectable()
export class AdminQueuesService {
  constructor(private readonly observation: QueueObservationService) {}

  async list(): Promise<AdminQueuesResponse> {
    const queues = await this.observation.observe()
    return { checkedAt: new Date().toISOString(), queues }
  }
}
