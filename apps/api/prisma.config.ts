import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

config({ path: '../../.env' })

// `E2E_DATABASE_URL` is the test-only escape hatch. Prisma CLI auto-loads `.env`
// with override semantics before this config file evaluates, which clobbers any
// `DATABASE_URL` the parent test process set on `process.env`. By picking a var
// name that is NOT declared in `.env`, the CLI's auto-load can't touch it, so
// e2e tests can route migrations to a testcontainer DB while production paths
// keep using `DATABASE_URL`.
// Fallback URL for CI where .env doesn't exist (only needed for generate, not actual DB operations)
const databaseUrl =
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://placeholder:placeholder@localhost:5432/placeholder'

export default defineConfig({
  schema: './prisma',
  datasource: {
    url: databaseUrl,
  },
})
