import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

import { EnvService } from '../env/env.service'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(env: EnvService) {
    const pool = new Pool({
      connectionString: env.get('DATABASE_URL'),
    })
    const adapter = new PrismaPg(pool)

    super({ adapter })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
