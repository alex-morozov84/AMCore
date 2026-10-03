import { Injectable, ServiceUnavailableException } from '@nestjs/common'

import { decodeSetting } from './setting-codec'
import type { SettingDefinition, SettingRow } from './setting-definition'

import { PrismaService } from '@/prisma'

@Injectable()
export class SettingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async read<T>(
    definition: SettingDefinition<T>
  ): Promise<{ row: SettingRow; override: T | undefined }> {
    const row = (await this.refresh([definition.key]))[0]
    if (!row) throw new ServiceUnavailableException('Required setting row missing')
    return { row, override: decodeSetting(definition, row) }
  }

  refresh(keys: readonly string[]): Promise<SettingRow[]> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`
        return tx.platformSetting.findMany({ where: { key: { in: [...keys] } } })
      },
      { maxWait: 1000, timeout: 3500 }
    )
  }
}
