import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const ignoredParts = new Set(['node_modules', '.next', 'coverage', 'dist', 'storybook-static'])

export function resolvePublicRepoRoot(start = scriptDirectory) {
  try {
    const found = execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (!found) throw new Error('empty Git root')
    return realpathSync(found)
  } catch (error) {
    throw new Error(`cannot resolve public repository root from ${start}`, { cause: error })
  }
}

function gitFiles(root, args) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
}

function excluded(file) {
  return (
    file === 'ai' ||
    file.startsWith('ai/') ||
    file.split('/').some((part) => ignoredParts.has(part))
  )
}

function copyEntry(sourceRoot, targetRoot, relative, mayBeDeleted) {
  const source = path.join(sourceRoot, relative)
  let stat
  try {
    stat = lstatSync(source)
  } catch (error) {
    if (mayBeDeleted && error.code === 'ENOENT') return
    throw error
  }
  const target = path.join(targetRoot, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), target)
  else if (stat.isFile()) {
    copyFileSync(source, target)
    chmodSync(target, stat.mode & 0o777)
  } else throw new Error(`unsupported working-tree entry: ${relative}`)
}

export function createWorkingTreeCopy(sourceRoot = resolvePublicRepoRoot()) {
  const root = realpathSync(sourceRoot)
  if (resolvePublicRepoRoot(root) !== root) throw new Error(`not a Git root: ${root}`)
  const copy = mkdtempSync(path.join(tmpdir(), 'amcore-working-tree-'))
  try {
    const tracked = gitFiles(root, ['--cached']).filter((file) => !excluded(file))
    const untracked = gitFiles(root, ['--others', '--exclude-standard']).filter(
      (file) => !excluded(file)
    )
    for (const file of tracked) copyEntry(root, copy, file, true)
    for (const file of untracked) copyEntry(root, copy, file, false)
    return { root: copy, cleanup: () => rmSync(copy, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(copy, { recursive: true, force: true })
    throw error
  }
}
