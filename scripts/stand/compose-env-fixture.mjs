import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const example = readFileSync(join(root, '.env.example'), 'utf8')
export const activeEnvironment = Object.fromEntries(
  [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(([, key, raw]) => {
    const value = raw.match(/^(?:"([^"]*)"|'([^']*)'|([^#]*))/)
    return [key, (value[1] ?? value[2] ?? value[3]).trim()]
  })
)

// These settings deliberately differ between native development and containers.
export const environmentExceptions = {
  COMPOSE_PROFILES: 'profile selection, not container environment',
  DATABASE_URL: 'mapped from COMPOSE_DATABASE_URL instead of the native URL',
  REDIS_URL: 'mapped from COMPOSE_REDIS_URL instead of the native URL',
  API_PORT: 'fixed container port 5002, independent of the native API port',
}

export function targetServices(key) {
  if (['NODE_ENV', 'FRONTEND_URL', 'WEB_FRONTEND_CONTEXT_KEY'].includes(key))
    return ['api', 'worker', 'web']
  if (key.startsWith('WEB_') || key.startsWith('ADMIN_CONSOLE_')) return ['web']
  return ['api', 'worker']
}

export function composeEnvironment(values = {}, files = ['docker-compose.yml']) {
  const directory = mkdtempSync(join(tmpdir(), 'amcore-compose-env-'))
  const envFile = join(directory, 'synthetic.env')
  try {
    writeFileSync(
      envFile,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    )
    return JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--profile',
          'seed',
          '--env-file',
          envFile,
          ...files.flatMap((file) => ['-f', join(root, file)]),
          'config',
          '--format',
          'json',
        ],
        {
          cwd: root,
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        }
      )
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
