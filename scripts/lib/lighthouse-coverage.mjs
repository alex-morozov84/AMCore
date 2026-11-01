import { join } from 'node:path'
import { assertSupportedNext, expectedPages, readJson } from './route-budget-inputs.mjs'
import { keyRoutes } from './route-budget-policy.mjs'
import { auditCatalogue, auditChoices, invariant, digest } from './lighthouse-plan.mjs'

export function checkCoverage(pages, catalogue, resolvers) {
  const keyed = keyRoutes(pages, resolvers)
  const rows = new Map()
  for (const row of catalogue.coverage) {
    invariant(!rows.has(row.route) && keyed.has(row.route), 'duplicate-or-stale-coverage')
    invariant(['audited', 'representative', 'excluded'].includes(row.kind), 'invalid-coverage-kind')
    if (row.kind !== 'audited')
      invariant(
        typeof row.reason === 'string' && row.reason.trim().length >= 15,
        'coverage-needs-reason'
      )
    if (row.kind !== 'excluded')
      invariant(
        catalogue.scenarios.some((s) => s.id === row.scenario),
        'unknown-coverage-scenario'
      )
    rows.set(row.route, row)
  }
  invariant(keyed.size === rows.size && catalogue.scenarios.length > 0, 'missing-or-empty-coverage')
  for (const s of catalogue.scenarios) {
    const key = `${s.scope === 'product' ? 'app' : s.scope}:${s.path}`
    invariant(
      rows.get(key)?.kind === 'audited' && rows.get(key)?.scenario === s.id,
      'missing-audited-page'
    )
  }
  return [...rows.values()].sort((a, b) => a.route.localeCompare(b.route))
}

export function collectCoverage(root, input) {
  const choices = auditChoices(root)
  const catalogue = auditCatalogue(root, choices)
  assertSupportedNext(
    input?.next ?? readJson(join(root, 'apps/web/node_modules/next/package.json'), 'Next').version
  )
  const pages = expectedPages(
    input?.pages ??
      readJson(join(root, 'apps/web/.next/app-path-routes-manifest.json'), 'built manifest')
  )
  const resolvers = [{ scope: 'product-admin', prefix: `/${choices.productAdmin.alias}` }]
  resolvers.push({ scope: 'console', prefix: `/${choices.console.slug}` })
  const rows = checkCoverage(pages, catalogue, resolvers)
  return {
    rows,
    digest: digest(rows),
    pages: [...pages],
    build: input?.build ?? readJsonOrText(root),
  }
}

import { readFileSync } from 'node:fs'
function readJsonOrText(root) {
  const build = readFileSync(join(root, 'apps/web/.next/BUILD_ID'), 'utf8').trim()
  invariant(build.length > 0, 'empty-build-id')
  return build
}
