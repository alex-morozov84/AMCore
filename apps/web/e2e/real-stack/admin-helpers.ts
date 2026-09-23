import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

/**
 * `docker-compose.yml` lives at the repo root and this lane's stack is
 * started with no explicit `-p` (`docs/frontend/testing.md`:
 * `docker compose --profile local-infra up -d --build`, run from the repo
 * root) - Compose derives the project name from that directory. Passing
 * the same `--project-directory` here, instead of guessing that derived
 * name as a literal string, resolves to the same running project
 * regardless of what the repo checkout happens to be named.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..')

function composeExec(service: string, ...args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '--project-directory', REPO_ROOT, 'exec', '-T', service, ...args],
    { encoding: 'utf8' }
  )
}

export function setSystemRole(email: string, role: 'USER' | 'SUPER_ADMIN'): void {
  composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-c',
    `UPDATE core.users SET "systemRole" = '${role}' WHERE "emailCanonical" = '${email}';`
  )
}

/**
 * Counts a user's live (non-revoked) backend session rows. A role change
 * deletes them outright, but an already-issued, still-time-valid access
 * token keeps working in the browser until it naturally expires or is
 * refreshed — deleting the row does not retroactively invalidate it. So the
 * database, not an immediate browser redirect, is the correct place to
 * assert that a role change actually revoked the target's sessions.
 */
export function countLiveSessions(email: string): number {
  const output = composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-t',
    '-A',
    '-c',
    `SELECT count(*) FROM core.sessions s JOIN core.users u ON u.id = s."userId" ` +
      `WHERE u."emailCanonical" = '${email}' AND s."revokedAt" IS NULL;`
  )
  return Number(output.trim())
}

/**
 * Ages a user's live session(s) well past `STEP_UP_MAX_AGE_SECONDS` (default
 * 600s) so the next `@RequireFreshAuth` route (e.g. the role-change PATCH)
 * returns `STEP_UP_REQUIRED` instead of succeeding silently. A freshly
 * logged-in operator is always inside the freshness window, so this is the
 * only way a real-stack test can open the step-up dialog deterministically.
 */
export function ageSessionLastAuthAt(email: string): void {
  composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-c',
    `UPDATE core.sessions SET "lastAuthAt" = now() - interval '20 minutes' ` +
      `WHERE "userId" = (SELECT id FROM core.users WHERE "emailCanonical" = '${email}') ` +
      `AND "revokedAt" IS NULL;`
  )
}

/**
 * See `e2e/console-real-stack/helpers.ts`'s `createOrganization` for why a
 * random UUID is fine here. `createdAt` defaults to `now()`; pass an
 * explicit `Date` for deterministic sort-order assertions (mirrors
 * `createNamedUser`'s own `createdAt` parameter below).
 */
export function createOrganization(name: string, slug: string, createdAt?: Date): void {
  const createdAtSql = createdAt ? `'${createdAt.toISOString()}'` : 'now()'
  composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-c',
    `INSERT INTO core.organizations (id, name, slug, "createdAt", "updatedAt") ` +
      `VALUES ('${randomUUID()}', '${name}', '${slug}', ${createdAtSql}, now());`
  )
}

/**
 * Inserts one user row directly (no password, never signs in) — fixture
 * data for search/sort assertions, same direct-SQL approach as
 * {@link createUsersForPagination}. `createdAt` is caller-controlled so
 * sort-order assertions don't depend on insertion order or the current
 * accumulation of prior e2e runs' leftover rows.
 */
export function createNamedUser(email: string, name: string, createdAt: Date): void {
  composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-c',
    `INSERT INTO core.users (id, email, "emailCanonical", name, "createdAt", "updatedAt") ` +
      `VALUES ('${randomUUID()}', '${email}', '${email}', '${name}', '${createdAt.toISOString()}', now());`
  )
}

/** Creates future-dated rows so a pagination marker deterministically lands on page two. */
export function createUsersForPagination(markerEmail: string, fillerPrefix: string): void {
  const marker = `('${randomUUID()}', '${markerEmail}', '${markerEmail}', now(), now())`
  const fillers = Array.from({ length: 20 }, (_, index) => {
    const email = `${fillerPrefix}-${index}@e2e.amcore.test`
    return `('${randomUUID()}', '${email}', '${email}', now() + interval '${index + 1} seconds', now())`
  })
  composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-c',
    `INSERT INTO core.users (id, email, "emailCanonical", "createdAt", "updatedAt") VALUES ${[
      marker,
      ...fillers,
    ].join(', ')};`
  )
}
