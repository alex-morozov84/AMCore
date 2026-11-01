import { productAdminCiLanes } from './product-admin-e2e-plan.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const specPattern = /\.(spec|test)\.[cm]?[jt]sx?$/
export function specFiles(root, directory = 'apps/web/e2e/real-stack') {
  const base = join(root, directory)
  if (!existsSync(base)) throw new Error(`Missing E2E directory: ${directory}`)
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        specPattern.test(entry.name) &&
        !(
          directory === 'apps/web/e2e/real-stack' &&
          entry.name === 'product-admin-oauth-path.spec.ts'
        )
    )
    .map((entry) => relative(join(root, 'apps/web'), join(entry.parentPath, entry.name)))
    .sort()
}

// Specs that stall or pause the stand's shared services run in their own lane. The Redis outage
// specs pause Redis for seconds at a time, which the standard lane's time budget cannot absorb.
export const disruptiveSpec = (file) =>
  /(?:runtime-settings|background-work|redis-outage-session|redis-outage-controls|redis-stall|refresh-owner-held)\.(?:spec|test)\./.test(
    file
  )
export function selectedFiles(root, group) {
  if (!['standard', 'disruptive'].includes(group)) throw new Error('Unknown E2E group')
  return specFiles(root).filter((file) => disruptiveSpec(file) === (group === 'disruptive'))
}

export function ciLanes(root) {
  const lanes = ['safety', 'mocked', 'path-standard', 'setup-cli']
  if (selectedFiles(root, 'disruptive').length) lanes.push('path-disruptive')
  if (existsSync(join(root, 'scripts/run-console-session-e2e.mjs')))
    lanes.push('host', 'setup-console')
  return [...lanes, ...productAdminCiLanes(root)]
}
