/* eslint-disable no-console */
import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'

import { seedAiCatalog } from './seed-ai-catalog'
import { seedOrgRoles } from './seed-org-roles'

// Prisma 7 requires a driver adapter; mirror prisma.config.ts so `prisma db seed`
// (and a standalone `tsx prisma/seed.ts`) resolve `DATABASE_URL` and connect.
config({ path: '../../.env' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main(): Promise<void> {
  await seedOrgRoles(prisma)
  await seedAiCatalog(prisma)
  console.log('System roles and AI catalogue seeded')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
