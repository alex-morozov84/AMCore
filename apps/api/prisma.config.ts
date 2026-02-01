import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

config({ path: '../../.env' })

// Fallback URL for CI where .env doesn't exist (only needed for generate, not actual DB operations)
const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://placeholder:placeholder@localhost:5432/placeholder'

export default defineConfig({
  schema: './prisma',
  datasource: {
    url: databaseUrl,
  },
})
