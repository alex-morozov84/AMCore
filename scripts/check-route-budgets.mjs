#!/usr/bin/env node
// Fails when a web page's first-load JS exceeds its budget, or when the build's route
// measurement is incomplete. Run it right after `next build` in the same job; it reads
// apps/web/.next and never builds. Contract: docs/frontend/bundle-budget.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  assertChunks,
  assertSameRoutes,
  assertSupportedNext,
  expectedPages,
  readJson,
  RouteBudgetError,
  statsRows,
} from './lib/route-budget-inputs.mjs'
import { evaluate, keyRoutes, mergeBudgets } from './lib/route-budget-policy.mjs'

const root = path.resolve(import.meta.dirname, '..')
const webRoot = path.join(root, 'apps/web')
const next = path.join(webRoot, '.next')

function readText(file, label) {
  if (!existsSync(file)) throw new RouteBudgetError(`${label} is missing: ${file}`)
  return readFileSync(file, 'utf8')
}

function scopeRegistry() {
  const alias = readJson(
    path.join(root, 'packages/shared/src/config/product-admin.json'),
    'product-admin config'
  ).alias
  if (!/^[a-z0-9-]+$/.test(alias ?? '')) throw new RouteBudgetError('invalid product-admin alias')
  const resolvers = [{ scope: 'product-admin', prefix: `/${alias}` }]
  const mandatory = ['app:/', 'app:/login', 'app:/register', 'app:/settings/sessions']
  mandatory.push('product-admin:/organizations')
  const consoleConfig = readText(
    path.join(webRoot, 'src/shared/lib/admin-console.generated.ts'),
    'Console config'
  )
  const slug = consoleConfig.match(/^\s*slug: '([a-z0-9-]+)',$/m)?.[1]
  if (!/^\s*enabled: true,$/m.test(consoleConfig) || !slug)
    throw new RouteBudgetError('Console config needs enabled: true and a valid slug')
  resolvers.push({ scope: 'admin-console', prefix: `/${slug}` })
  mandatory.push('admin-console:/')
  return { resolvers, mandatory, scopes: new Set(['app', ...resolvers.map((r) => r.scope)]) }
}

function budgetFiles() {
  const src = path.join(webRoot, 'src')
  const nested = readdirSync(src, { recursive: true })
    .filter((name) => path.basename(name) === 'route-budgets.json')
    .map((name) => path.join(src, name))
  return [path.join(webRoot, 'route-budgets.json'), ...nested].map((file) => ({
    file: path.relative(root, file),
    json: readJson(file, 'route budget file'),
  }))
}

function provenance(statsText) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  }
  const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)
  const lock = path.join(root, 'pnpm-lock.yaml')
  // Next writes a non-empty ID; its format is Next's own, so only emptiness is checked.
  const buildId = readText(path.join(next, 'BUILD_ID'), 'BUILD_ID').trim()
  if (!buildId) throw new RouteBudgetError(`BUILD_ID is empty: ${path.join(next, 'BUILD_ID')}`)
  return [
    `source ${git(['rev-parse', 'HEAD'])}${git(['status', '--porcelain']) ? ' (dirty)' : ''}`,
    `lockfile ${existsSync(lock) ? hash(readFileSync(lock)) : 'missing'}`,
    `BUILD_ID ${buildId}`,
    `stats ${hash(statsText)}`,
  ].join(', ')
}

function gzipBytes(chunks) {
  return chunks.reduce(
    (sum, chunk) => sum + gzipSync(readFileSync(path.join(webRoot, chunk))).length,
    0
  )
}

try {
  const nextVersion = readJson(path.join(webRoot, 'node_modules/next/package.json'), 'Next').version
  assertSupportedNext(nextVersion)
  const statsFile = path.join(next, 'diagnostics/route-bundle-stats.json')
  const rows = statsRows(readJson(statsFile, 'route-bundle-stats.json'))
  assertSameRoutes(
    expectedPages(readJson(path.join(next, 'app-path-routes-manifest.json'), 'manifest')),
    rows
  )
  assertChunks(webRoot, rows)
  const { resolvers, mandatory, scopes } = scopeRegistry()
  const keyed = keyRoutes(rows.keys(), resolvers)
  const { report, failures } = evaluate(keyed, rows, mergeBudgets(budgetFiles(), scopes), mandatory)
  console.log(`Route budgets (Next ${nextVersion}; ${provenance(readFileSync(statsFile, 'utf8'))})`)
  for (const { key, route, bytes, limit, over } of report)
    console.log(
      `${over ? 'OVER' : 'ok  '} ${key.padEnd(48)} ${String(bytes).padStart(9)} / ${String(limit ?? 'none').padStart(11)}  gzip ${gzipBytes(rows.get(route).chunks)}`
    )
  if (failures.length) {
    console.error(`\nRoute budget check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
} catch (error) {
  if (!(error instanceof RouteBudgetError)) throw error
  console.error(`Route budget check failed: ${error.message}`)
  process.exit(1)
}
