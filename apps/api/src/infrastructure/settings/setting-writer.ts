import { HttpStatus, Injectable } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'
import { ResourceErrorCode } from '@amcore/shared'

import { canonicalValue, decodeSetting, encodeSetting } from './setting-codec'
import type { SettingDefinition, SettingRow } from './setting-definition'
import { SettingRegistry } from './setting-registry'

import { AppException, ServiceUnavailableException } from '@/common/exceptions'
import { AuditLogService } from '@/core/audit'
import { AuditActorType, AuditTargetType, Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

/** Internal primitive: the domain facade authorizes actor/target before entry. */
@Injectable()
export class SettingWriter {
  constructor(
    private readonly registry: SettingRegistry,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  async write<T>(
    definition: SettingDefinition<T>,
    value: T | undefined,
    expectedRevision: number,
    actor: RequestPrincipal
  ): Promise<SettingRow> {
    this.registry.assert(definition)
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > 2_147_483_647
    )
      throw new Error('Invalid setting revision')
    const normalized = value === undefined ? undefined : encodeSetting(definition, value).value
    const encoded = value === undefined ? Prisma.DbNull : encodeSetting(definition, normalized as T)
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`
        await tx.$queryRaw`SELECT key FROM core.platform_settings WHERE key = ${definition.key} FOR UPDATE`
        const row = await tx.platformSetting.findUnique({ where: { key: definition.key } })
        if (!row) throw new ServiceUnavailableException('Required setting row missing')
        if (row.revision !== expectedRevision)
          throw new AppException(
            'Setting changed; reread before saving',
            HttpStatus.CONFLICT,
            ResourceErrorCode.SETTING_REVISION_CONFLICT
          )
        const before = decodeSetting(definition, row)
        if (canonicalValue(before) === canonicalValue(normalized)) return row
        if (row.revision === 2_147_483_647)
          throw new ServiceUnavailableException('Setting revision exhausted')
        const after = await tx.platformSetting.update({
          where: { key: definition.key, revision: expectedRevision },
          data: { override: encoded as Prisma.InputJsonValue, revision: { increment: 1 } },
        })
        await this.audit.record(
          {
            action: 'admin.runtime_setting.changed',
            actorId: actor.sub,
            actorType: AuditActorType.USER,
            targetType: AuditTargetType.RUNTIME_SETTING,
            targetId: definition.auditTarget,
            metadata: {
              settingKey: definition.key,
              beforeRevision: row.revision,
              afterRevision: after.revision,
              ...definition.auditProjection(before, normalized),
            },
          },
          { tx }
        )
        return after
      },
      { maxWait: 1000, timeout: 3500 }
    )
  }
}
