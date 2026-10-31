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
  const text = readFileSync(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const field = (key) =>
    text
      .split('\n')
      .find((line) => line.startsWith(`- **${key}:** `))
      ?.split(':** ')[1]
  const productAdmin = json(root, 'packages/shared/src/config/product-admin.json')
  const choices = {
    productAdmin,
    locale: field('base_locale'),
    multi: field('i18n_mode') === 'multi',
  }
  invariant(
    ['path', 'host'].includes(productAdmin.mode) && /^[a-z0-9-]+$/.test(productAdmin.alias),
    'invalid-placement'
  )
  invariant(/^[a-z]{2}(?:-[A-Za-z0-9]+)?$/.test(choices.locale), 'invalid-locale')
  choices.exclusions = text.split('\n').flatMap((line) => {
    const field = line.match(/^- \*\*([a-z_]+):\*\* disabled$/)
    return field ? [{ feature: field[1], reason: 'disabled-at-initialization' }] : []
  })
  choices.extensions = []
  // AMCORE_CONSOLE_LIGHTHOUSE_CHOICES_START
  invariant(field('admin_console') === 'enabled', 'invalid-console-choice')
  choices.console = { mode: field('admin_console_mode'), slug: field('admin_console_slug') }
  invariant(
    ['path', 'host'].includes(choices.console.mode) && /^[a-z0-9-]+$/.test(choices.console.slug),
    'invalid-console-placement'
  )
  choices.extensions.push('apps/web/e2e/console-real-stack/lighthouse/catalogue.json')
  // AMCORE_CONSOLE_LIGHTHOUSE_CHOICES_END
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

export function auditPlan(root, identity) {
  invariant(
    /^[a-zA-Z0-9-]+$/.test(identity.run) &&
      /^\d+$/.test(identity.attempt) &&
      /^[a-f0-9]{40}$/.test(identity.source),
    'invalid-run-identity'
  )
  const choices = auditChoices(root)
  const catalogue = auditCatalogue(root, choices)
  const lanes = ciLanes(root)
  const owner = (scope) => {
    if (scope === 'product') return 'path-standard'
    if (scope === 'product-admin')
      return choices.productAdmin.mode === 'host' ? 'staff-oauth' : 'path-standard'
    // AMCORE_CONSOLE_LIGHTHOUSE_OWNER_START
    if (scope === 'console') return choices.console.mode === 'host' ? 'host' : 'path-standard'
    // AMCORE_CONSOLE_LIGHTHOUSE_OWNER_END
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
  // AMCORE_CONSOLE_LIGHTHOUSE_URL_START
  if (scenario.scope === 'console') {
    origin = m.consoleTopology === 'host' ? m.origins.console : origin
    prefix += m.consoleTopology === 'host' ? '' : `/${m.consoleSlug}`
  }
  // AMCORE_CONSOLE_LIGHTHOUSE_URL_END
  invariant(typeof origin === 'string', 'missing-scenario-origin')
  const path = scenario.path.replace(/\[([a-zA-Z]+)\]/g, (_, key) => {
    invariant(/^[a-zA-Z0-9_-]+$/.test(values[key] ?? ''), 'missing-fixture-param')
    return values[key]
  })
  return new URL(prefix + (path === '/' ? '' : path) || '/', origin).href
}
