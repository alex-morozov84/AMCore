import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const specPattern = /\.(spec|test)\.[cm]?[jt]sx?$/
export function specFiles(root, directory = 'apps/web/e2e/real-stack') {
  const base = join(root, directory)
  if (!existsSync(base)) throw new Error(`Missing E2E directory: ${directory}`)
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && specPattern.test(entry.name))
    .map((entry) => relative(join(root, 'apps/web'), join(entry.parentPath, entry.name)))
    .sort()
}

export const disruptiveSpec = (file) =>
  /(?:runtime-settings|background-work)\.(?:spec|test)\./.test(file)
export function selectedFiles(root, group) {
  if (!['standard', 'disruptive'].includes(group)) throw new Error('Unknown E2E group')
  return specFiles(root).filter((file) => disruptiveSpec(file) === (group === 'disruptive'))
}

export function ciLanes(root) {
  const lanes = ['safety', 'mocked', 'path-standard']
  if (selectedFiles(root, 'disruptive').length) lanes.push('path-disruptive')
  // AMCORE_CONSOLE_CI_LANES_START
  if (existsSync(join(root, 'scripts/run-console-session-e2e.mjs'))) lanes.push('host')
  // AMCORE_CONSOLE_CI_LANES_END
  return lanes
}
