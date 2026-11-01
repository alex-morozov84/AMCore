import { assertRequiredAudits } from './lighthouse-required.mjs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ciLanes } from '../e2e-ci-plan.mjs'

export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex')
export const json = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'))
export const invariant = (ok, code) => {
  if (!ok) throw new Error(code)
}

export function auditChoices(root) {
  // Locale and Console choices come from the settings files (PROJECT_CONTEXT.md no longer holds them).
  const productAdmin = json(root, 'packages/shared/src/config/product-admin.json')
  const locales = json(root, 'packages/shared/src/config/locales.json')
  const adminConsole = json(root, 'packages/shared/src/config/admin-console.json')
  const choices = {
    productAdmin,
    locale: locales.default,
    multi: locales.enabled.length > 1,
  }
  invariant(
    ['path', 'host'].includes(productAdmin.mode) && /^[a-z0-9-]+$/.test(productAdmin.alias),
    'invalid-placement'
  )
  invariant(/^[a-z]{2}(?:-[A-Za-z0-9]+)?$/.test(choices.locale), 'invalid-locale')
  choices.exclusions = []
  choices.extensions = []
  invariant(
    ['disabled', 'path', 'host'].includes(adminConsole.mode) &&
      /^[a-z0-9-]+$/.test(adminConsole.alias),
    'invalid-console-placement'
  )
  if (adminConsole.mode === 'disabled') {
    // A disabled Console answers 404 everywhere, so it has nothing to audit.
    choices.console = null
    choices.exclusions.push({ feature: 'admin_console', reason: 'disabled-by-settings' })
  } else {
    choices.console = { mode: adminConsole.mode, slug: adminConsole.alias }
    choices.extensions.push('apps/web/e2e/console-real-stack/lighthouse/catalogue.json')
  }
  return choices
}

export function auditCatalogue(root, choices = auditChoices(root)) {
  const files = ['apps/web/e2e/lighthouse/catalogue.json', ...choices.extensions]
  const parts = files.map((file) => json(root, file))
  const scenarios = parts.flatMap((part) => part.scenarios)
  const coverage = parts.flatMap((part) => part.coverage)
  invariant(
    scenarios.length > 0 && new Set(scenarios.map((s) => s.id)).size === scenarios.length,
    'empty-or-duplicate-scenarios'
  )
  for (const s of scenarios) {
    assertRequiredAudits(s.requiredAudits)
    invariant(
      /^[a-z][a-z0-9-]{0,50}$/.test(s.id) &&
        s.id !== 'index' &&
        ['product', 'product-admin', ...choices.extensions.map(() => 'console')].includes(s.scope),
      'invalid-scenario'
    )
    invariant(
      typeof s.label === 'string' &&
        s.label.length > 0 &&
        s.label.length <= 120 &&
        [...s.label].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) &&
        s.path.startsWith('/') &&
        typeof s.indexable === 'boolean' &&
        Array.isArray(s.requiredAudits),
      'invalid-scenario-contract'
    )
  }
  return { scenarios, coverage }
}

export function auditScope(root) {
  const choices = auditChoices(root)
  const catalogue = auditCatalogue(root, choices)
  const lanes = ciLanes(root)
  const owner = (scope) => {
    if (scope === 'product') return 'path-standard'
    if (scope === 'product-admin')
      return choices.productAdmin.mode === 'host' ? 'staff-oauth' : 'path-standard'
    if (scope === 'console') return choices.console.mode === 'host' ? 'host' : 'path-standard'
    throw new Error('unknown-scenario-scope')
  }
  const assignments = Object.fromEntries(
    lanes.map((lane) => [
      lane,
      catalogue.scenarios.filter((s) => owner(s.scope) === lane).map((s) => s.id),
    ])
  )
  invariant(
    catalogue.scenarios.every((s) => lanes.includes(owner(s.scope))),
    'missing-required-owner'
  )
  invariant(catalogue.scenarios.length <= 3, 'scenario-count-requires-budget-admission')
  return { choices, catalogue, assignments }
}

export function auditPlan(root, identity) {
  invariant(
    /^[a-zA-Z0-9-]+$/.test(identity.run) &&
      /^\d+$/.test(identity.attempt) &&
      /^[a-f0-9]{40}$/.test(identity.source),
    'invalid-run-identity'
  )
  const { choices, catalogue, assignments } = auditScope(root)
  const plan = {
    version: 1,
    ...identity,
    config: digest(choices),
    descriptors: digest(catalogue),
    choices,
    assignments,
    pages: catalogue.scenarios.map(({ id, label, path }) => ({ id, label, path })),
    exclusions: choices.exclusions,
  }
  return { ...plan, digest: digest(plan) }
}

export function scenarioUrl(scenario, m, values = {}) {
  let origin = m.origins.product
  let prefix = m.localePrefix
  if (scenario.scope === 'product-admin') {
    origin = m.productAdminHost ? m.origins.staff : origin
    prefix += m.productAdminHost ? '' : `/${values.alias}`
  }
  if (scenario.scope === 'console') {
    origin = m.consoleTopology === 'host' ? m.origins.console : origin
    prefix += m.consoleTopology === 'host' ? '' : `/${m.consoleSlug}`
  }
  invariant(typeof origin === 'string', 'missing-scenario-origin')
  const path = scenario.path.replace(/\[([a-zA-Z]+)\]/g, (_, key) => {
    invariant(/^[a-zA-Z0-9_-]+$/.test(values[key] ?? ''), 'missing-fixture-param')
    return values[key]
  })
  return new URL(prefix + (path === '/' ? '' : path) || '/', origin).href
}
