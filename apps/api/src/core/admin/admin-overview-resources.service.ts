import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import type { z } from 'zod'

import {
  adminOverviewFilesystemSchema,
  adminOverviewMemorySchema,
  adminOverviewPoolSchema,
  type AdminOverviewResponse,
} from '@amcore/shared'

import { sampleOverviewFilesystem } from './admin-overview-filesystem'

import { EnvService } from '@/env/env.service'
import { PrismaService } from '@/prisma'

/** Safe independent snapshots. No cross-request state, timer, cache or health verdict. */
@Injectable()
export class AdminOverviewResourcesService {
  private readonly instanceId = randomUUID()

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService
  ) {}

  async sample(): Promise<Pick<AdminOverviewResponse, 'process' | 'resources'>> {
    const filesystem = this.sampleFilesystem()
    const pool = this.samplePool()
    const memory = this.sampleMemory()
    return {
      process: {
        instanceId: this.instanceId,
        uptimeSeconds: process.uptime(),
        sampledAt: new Date().toISOString(),
      },
      resources: { pool, memory, filesystem: await filesystem },
    }
  }

  private samplePool(): AdminOverviewResponse['resources']['pool'] {
    return safeSample(adminOverviewPoolSchema, () => ({
      ...this.prisma.getPoolStats(),
      max: this.env.get('DATABASE_POOL_MAX'),
      waitingThreshold: this.env.get('DATABASE_POOL_WAITING_THRESHOLD'),
    }))
  }

  private sampleMemory(): AdminOverviewResponse['resources']['memory'] {
    return safeSample(adminOverviewMemorySchema, () => {
      const { heapUsed, rss } = process.memoryUsage()
      return {
        heapUsedBytes: heapUsed,
        rssBytes: rss,
        readinessHeapLimitBytes: this.env.get('HEALTH_MEMORY_HEAP_BYTES') ?? 1024 * 1024 * 1024,
      }
    })
  }

  private async sampleFilesystem(): Promise<AdminOverviewResponse['resources']['filesystem']> {
    try {
      const values = await sampleOverviewFilesystem()
      return safeSample(adminOverviewFilesystemSchema, () => ({
        ...values,
        pressureThreshold: this.env.get('HEALTH_DISK_THRESHOLD_PERCENT'),
      }))
    } catch {
      return { status: 'unavailable' as const, sampledAt: null }
    }
  }
}

function safeSample<T>(schema: z.ZodType<T>, read: () => unknown): T {
  try {
    const values = read() as object
    return schema.parse({ status: 'available', sampledAt: new Date().toISOString(), ...values })
  } catch {
    return schema.parse({ status: 'unavailable', sampledAt: null })
  }
}
