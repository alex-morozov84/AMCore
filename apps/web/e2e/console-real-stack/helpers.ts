import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const project = process.env.CONSOLE_E2E_PROJECT ?? 'amcore-console-e2e'

export function setSystemRole(email: string, role: 'USER' | 'SUPER_ADMIN'): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'amcore',
      '-d',
      'amcore',
      '-c',
      `UPDATE core.users SET "systemRole" = '${role}' WHERE "emailCanonical" = '${email}';`,
    ],
    { stdio: 'pipe' }
  )
}

/** See `e2e/real-stack/admin-helpers.ts`'s `ageSessionLastAuthAt` — same
 * reason, same fixed offset, host-mode's own compose project/exec form. */
export function ageSessionLastAuthAt(email: string): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'amcore',
      '-d',
      'amcore',
      '-c',
      `UPDATE core.sessions SET "lastAuthAt" = now() - interval '20 minutes' ` +
        `WHERE "userId" = (SELECT id FROM core.users WHERE "emailCanonical" = '${email}') ` +
        `AND "revokedAt" IS NULL;`,
    ],
    { stdio: 'pipe' }
  )
}

export function redisKeys(namespace: string): string[] {
  const output = execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'redis',
      'redis-cli',
      '--scan',
      '--pattern',
      `${namespace}:*`,
    ],
    { encoding: 'utf8' }
  )
  return output.split('\n').filter(Boolean)
}

export function redisEntry(key: string): Record<string, unknown> {
  const output = execFileSync(
    'docker',
    ['compose', '-p', project, 'exec', '-T', 'redis', 'redis-cli', '--raw', 'GET', key],
    { encoding: 'utf8' }
  )
  return JSON.parse(output)
}

/**
 * Creates a real organization row directly - no admin mutation endpoint
 * exists to do it via the UI. `id` only needs to be a unique string
 * (Prisma's `Organization.id` is CUID-shaped in production, but the column
 * itself is a plain `String`, so a random UUID is a valid, collision-free
 * substitute for a test row).
 */
export function createOrganization(name: string, slug: string): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'amcore',
      '-d',
      'amcore',
      '-c',
      `INSERT INTO core.organizations (id, name, slug, "createdAt", "updatedAt") ` +
        `VALUES ('${randomUUID()}', '${name}', '${slug}', now(), now());`,
    ],
    { stdio: 'pipe' }
  )
}
