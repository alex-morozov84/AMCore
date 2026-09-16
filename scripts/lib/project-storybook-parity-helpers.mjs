import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const STORYBOOK_PARITY_BASE = '7d7a74cc7b0f95602404c81e23cffe60746d3e5d'
export const INTENTIONAL_DELTAS = new Set([
  '.github/workflows/ci.yml',
  'apps/web/.gitignore',
  'docs/frontend/brand-theme-and-tokens.md',
  'docs/frontend/route-progress.md',
  'docs/frontend/testing.md',
  'docs/operations-console/development.md',
])

export function createBaseCopy() {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-storybook-parity-'))
  const archive = execFileSync('git', ['archive', STORYBOOK_PARITY_BASE], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const result = spawnSync('tar', ['-x', '-C', root], { input: archive })
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`)
  copyFileSync(
    path.join(process.cwd(), 'docs/frontend/brand-theme-and-tokens.md'),
    path.join(root, 'docs/frontend/brand-theme-and-tokens.md')
  )
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  }
}

export async function legacyPrepare(root) {
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const url = pathToFileURL(path.join(root, 'scripts/lib/project-init-plan.mjs')).href
  return (await import(url)).prepareProjectInit
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function record(root, relative) {
  const absolute = path.join(root, relative)
  const stat = lstatSync(absolute)
  if (stat.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(absolute) }
  return { kind: 'file', hash: hash(readFileSync(absolute)), mode: stat.mode & 0o777 }
}

function walk(root, relative = '', output = new Map()) {
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (!relative && entry.name === 'node_modules') continue
    const child = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) walk(root, child, output)
    else output.set(child, record(root, child))
  }
  return output
}

export function treeDiff(leftRoot, rightRoot) {
  const left = walk(leftRoot)
  const right = walk(rightRoot)
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((file) => JSON.stringify(left.get(file)) !== JSON.stringify(right.get(file)))
    .sort()
}

function relative(root, value) {
  return value ? path.relative(root, value).split(path.sep).join('/') : undefined
}

export function displayCapture(root, steps) {
  return steps
    .filter((step) => !INTENTIONAL_DELTAS.has(relative(root, step.target)))
    .map((step) => ({
      kind: step.kind,
      source: relative(root, step.source),
      target: relative(root, step.target),
      summary: step.summary,
      changed: step.changed,
    }))
}

export function operationCapture(plan) {
  return plan.operationPlan
    .operationsForApply()
    .filter((operation) => !INTENTIONAL_DELTAS.has(operation.target ?? operation.to))
    .map((operation) => ({
      kind: operation.kind,
      target: operation.target,
      from: operation.from,
      to: operation.to,
      mode: operation.mode,
      hash: operation.bytes ? hash(operation.bytes) : undefined,
    }))
}
