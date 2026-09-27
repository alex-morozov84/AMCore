import { guardedExec } from '../support/managed-target.mjs'

export {
  ageSessionLastAuthAt,
  countLiveSessions,
  createOrganization,
  setSystemRole,
} from '../real-stack/admin-helpers'

export function redisKeys(namespace: string): string[] {
  return guardedExec('redis', 'redis-cli', '--scan', '--pattern', `${namespace}:*`)
    .split('\n')
    .filter(Boolean)
}
export function redisEntry(key: string): Record<string, unknown> {
  return JSON.parse(guardedExec('redis', 'redis-cli', '--raw', 'GET', key))
}
