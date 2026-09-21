import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const IGNORED = new Set(['.next', 'coverage', 'node_modules', 'playwright-report', 'test-results'])

function walk(root, relative = 'apps/web') {
  const directory = path.join(root, relative)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name)) return []
    const target = path.join(relative, entry.name)
    if (entry.isDirectory()) return walk(root, target)
    return entry.isFile() && SOURCE.test(entry.name) ? [target] : []
  })
}

function tracked(root) {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps/web'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
    }
  )
  if (result.status !== 0) return undefined
  return result.stdout
    .split('\0')
    .filter((file) => file && SOURCE.test(file) && existsSync(path.join(root, file)))
}

export function localeGuardSourceFiles(root) {
  return tracked(root) ?? walk(root)
}
