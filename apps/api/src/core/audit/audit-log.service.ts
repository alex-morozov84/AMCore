import { Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../../prisma'

import { sanitizeAuditMetadata } from './audit-log.metadata'
import type { AuditLogEntry, AuditLogRecordOptions } from './audit-log.types'

import { AuditActorType, AuditCategory, type Prisma } from '@/generated/prisma/client'

@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AuditLogService.name)
  }

  async record(entry: AuditLogEntry, opts: AuditLogRecordOptions = {}): Promise<void> {
    const data = this.toCreateInput(entry)
    if (opts.tx) {
      await opts.tx.auditLog.create({ data })
      return
    }
    if (opts.failOpen === false) {
      // Strict, non-transactional: the caller needs this row durable BEFORE it proceeds
      // (privileged-read accountability — the transcript/artifact is not served until the access is
      // recorded). A failure propagates so the caller fails closed; it is never swallowed.
      await this.prisma.auditLog.create({ data })
      return
    }
    await this.recordBestEffort(data)
  }

  private async recordBestEffort(data: Prisma.AuditLogCreateInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data })
    } catch (err) {
      this.logger.warn(
        { action: data.action, err: err instanceof Error ? err.message : 'unknown' },
        'Failed to persist audit log'
      )
    }
  }

  private toCreateInput(entry: AuditLogEntry): Prisma.AuditLogCreateInput {
    return {
      action: entry.action,
      actorId: entry.actorId ?? this.resolveActorId(entry.actorType),
      actorType: entry.actorType,
      category: entry.category ?? AuditCategory.SECURITY,
      createdAt: new Date(),
      ip: entry.ip ?? this.readClsString('ip'),
      metadata: sanitizeAuditMetadata(entry.action, entry.metadata),
      organizationId: entry.organizationId ?? null,
      requestId: entry.requestId ?? this.cls.getId(),
      targetId: entry.targetId ?? null,
      targetType: entry.targetType ?? null,
    }
  }

  private resolveActorId(actorType: AuditActorType): string | null {
    if (actorType !== AuditActorType.USER) return null
    return this.readClsString('userId')
  }

  private readClsString(key: string): string | null {
    const value = this.cls.get(key)
    return typeof value === 'string' && value.length > 0 ? value : null
  }
}
