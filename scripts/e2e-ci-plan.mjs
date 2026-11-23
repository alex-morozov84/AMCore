import { readAdminConsoleSettings } from './lib/settings-files.mjs'
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

export function ciLanes(root, { configured = false, upstream = false } = {}) {
  if (configured && !upstream) return configuredLanes(root)
  const lanes = ['safety', 'mocked', 'path-standard', 'setup-cli']
  if (selectedFiles(root, 'disruptive').length) lanes.push('path-disruptive')
  if (existsSync(join(root, 'scripts/run-console-session-e2e.mjs')))
    lanes.push('host', 'setup-console')
  const variants = [...lanes, ...productAdminCiLanes(root)]
  if (!configured) return variants
  const native = configuredLanes(root)
  return [
    ...native,
    ...variants.filter(
      (lane) => !lane.startsWith('path-') && !native.includes(`configured-${lane}`)
    ),
  ]
}

export function requireBrowserTestOwner(root, files, role) {
  if (role !== 'downstream-product') return
  for (const file of files) {
    if (
      !file.startsWith('apps/web/e2e/') ||
      !specPattern.test(file) ||
      !existsSync(join(root, file))
    )
      continue
    const folder = file.split('/')[3]
    if (folder === 'real-stack' && !file.endsWith('/product-admin-oauth-path.spec.ts')) continue
    if (['mocked', 'server-mocked'].includes(folder)) continue
    if (folder === 'console-real-stack' && readAdminConsoleSettings(root).mode === 'host') continue
    throw new Error(`No configured browser executor for changed spec: ${file}`)
  }
}

export function configuredProject(lane) {
  if (lane === 'configured-mocked') return 'mocked'
  return lane === 'configured-console' ? 'console-real-stack' : 'real-stack'
}
export function configuredLanes(root) {
  const lanes = ['configured-standard']
  if (selectedFiles(root, 'disruptive').length) lanes.push('configured-disruptive')
  if (readAdminConsoleSettings(root).mode === 'host') lanes.push('configured-console')
  lanes.push('configured-mocked')
  return lanes
}

export function configuredArguments(root, lane) {
  if (!configuredLanes(root).includes(lane)) throw new Error('Inapplicable configured lane')
  const project = configuredProject(lane)
  const args = ['--lane', project]
  if (project === 'real-stack') args.push('--ci-group', lane.slice('configured-'.length))
  return [...args, '--settings-policy', 'preserve']
}

export const consoleFixtureLane = 'console-fixture'

export function consoleFixture(root) {
  const mode = readAdminConsoleSettings(root).mode
  if (mode === 'path')
    return {
      name: 'console-summary',
      prerequisite: 'requires:console-summary',
      project: 'real-stack',
      file: 'e2e/real-stack/admin-overview.spec.ts',
      args: ['admin-overview.spec.ts', '-g', 'summary fixture'],
    }
  if (mode === 'host')
    return {
      name: 'console-closed-signup-oauth',
      prerequisite: 'requires:closed-signup-oauth',
      project: 'console-real-stack',
      file: 'e2e/console-real-stack/invitation-closed-signup.spec.ts',
      args: ['invitation-closed-signup.spec.ts'],
    }
}
