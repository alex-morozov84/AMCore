import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { report } from '../migrator-lifecycle/safety.mjs'
export const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
export const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url))
export const emit = (f, check, details = {}) =>
  report(f, details.verdict ?? 'PASS', { check, ...details })
