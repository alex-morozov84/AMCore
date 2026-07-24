import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parse } from 'dotenv'
import type { z } from 'zod'

import { envBaseSchema, validate } from '../../env'

// Machine-enforced fork-fidelity: the root `.env.example` must document every env
// var the schema accepts, and must not document keys the schema doesn't know. This
// is the guard that stops `.env.example` drifting from `env/schema/*` — the exact
// place forks silently misconfigure. Both active (`KEY=`) and commented (`# KEY=`)
// examples count as documented (optional/advanced knobs are shown commented).

function findEnvExample(): string {
  let dir = __dirname
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, '.env.example')
    if (existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error(`.env.example not found walking up from ${__dirname}`)
}

const shape = envBaseSchema.shape as Record<string, z.ZodType>
const SCHEMA_KEYS = Object.keys(shape)

// Synthetic aggregate, populated by the composed preprocess from dynamic
// `WEBHOOK_<PROVIDER>_SECRET` keys — never set directly, so intentionally undocumented.
const SCHEMA_DENYLIST = new Set(['WEBHOOK_SECRETS'])

// Documented in `.env.example` but NOT part of the app's validated runtime env:
// compose/migration plumbing consumed by docker-compose, not by `validate()`.
const COMPOSE_ONLY_ALLOW = new Set([
  'COMPOSE_PROFILES',
  'COMPOSE_DATABASE_URL',
  'COMPOSE_REDIS_URL',
  'MIGRATION_DATABASE_URL',
  // Optional bundled Caddy `edge` profile — consumed by the `caddy` compose
  // service's own environment, not the app's env schema.
  'CADDY_DOMAIN',
  'CADDY_EMAIL',
  'CADDY_WEB_DOMAIN',
])
const WEBHOOK_SECRET_PATTERN = /^WEBHOOK_[A-Z0-9_]+_SECRET$/

const exampleText = readFileSync(findEnvExample(), 'utf8')
const documented = new Set(
  [...exampleText.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!)
)

describe('.env.example ↔ env schema coverage', () => {
  const GUIDE = 'docs/backend/architecture-and-conventions.md#adding-an-environment-variable'

  it('documents every schema key (active or commented), except the synthetic denylist', () => {
    const missing = SCHEMA_KEYS.filter(
      (key) => !documented.has(key) && !SCHEMA_DENYLIST.has(key)
    ).sort()
    expect(
      missing.length === 0
        ? 'ok'
        : `.env.example is missing ${missing.length} schema key(s): ${missing.join(', ')}. ` +
            `Add each in its section — active \`KEY=\` for required keys, commented \`# KEY=\` ` +
            `for optional/advanced ones. See ${GUIDE}.`
    ).toBe('ok')
  })

  it('documents no key that is neither a schema key nor an allowed compose/webhook key', () => {
    const unknown = [...documented]
      .filter(
        (key) =>
          !(key in shape) &&
          !SCHEMA_DENYLIST.has(key) &&
          !COMPOSE_ONLY_ALLOW.has(key) &&
          !WEBHOOK_SECRET_PATTERN.test(key)
      )
      .sort()
    expect(
      unknown.length === 0
        ? 'ok'
        : `.env.example documents ${unknown.length} key(s) the schema does not accept: ` +
            `${unknown.join(', ')}. Remove them, fix a typo, or (if compose-only) add to ` +
            `COMPOSE_ONLY_ALLOW in this spec. See ${GUIDE}.`
    ).toBe('ok')
  })

  // A fork runs `cp .env.example .env` and expects the app to boot. Its *active*
  // assignments must therefore validate as-is — e.g. a partially-filled OAuth
  // provider (active callback URL, empty credentials) would fail `validate()`, so
  // such optional groups must be shipped commented, not active-empty.
  it('is copyable: its active assignments pass validate() unchanged', () => {
    const parsed = parse(readFileSync(findEnvExample()))
    let error = ''
    try {
      validate(parsed)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    expect(
      error === ''
        ? 'ok'
        : `\`cp .env.example .env\` would not boot: ${error} — ship optional groups ` +
            `(e.g. OAuth providers) commented, not active-with-empty-values. See ${GUIDE}.`
    ).toBe('ok')
  })
})
