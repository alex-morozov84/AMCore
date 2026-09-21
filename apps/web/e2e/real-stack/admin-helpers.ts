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

/** See `e2e/console-real-stack/helpers.ts`'s `createOrganization` for why a random UUID is fine here. */
export function createOrganization(name: string, slug: string): void {
  composeExec(
    'postgres',
    'psql',
    '-U',
    'amcore',
    '-d',
    'amcore',
    '-c',
    `INSERT INTO core.organizations (id, name, slug, "createdAt", "updatedAt") ` +
      `VALUES ('${randomUUID()}', '${name}', '${slug}', now(), now());`
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
