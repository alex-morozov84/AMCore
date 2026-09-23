// Runtime inventory of the operations produced for the eight real measured
// scenarios. It builds plans against one disposable pristine tree but never
// applies them, installs dependencies, or derives expectations from output.
import { existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { resolvePublicRepoRoot } from '../lib/working-tree-fixture.mjs'
import { parseProjectFlags } from '../lib/project-flags.mjs'
import { DEFAULT_ADMIN_CONSOLE_SLUG } from '../lib/project-config-admin-console.mjs'
import { prepareProjectInit } from '../lib/project-init-plan.mjs'
import { countAllSemanticClaims } from '../lib/project-semantic-metrics.mjs'
import { INVENTORY_SCENARIOS } from './scenario-registry.mjs'

function relativeTo(root, value) {
  return value ? path.relative(root, value).split(path.sep).join('/') : null
}

function pathType(value) {
  if (!value || !existsSync(value)) return 'missing'
  const stat = lstatSync(value)
  if (stat.isSymbolicLink()) return 'symlink'
  if (stat.isDirectory()) return 'directory'
  if (stat.isFile()) return 'file'
  return 'other'
}

function operationRecord(root, scenario, step, operationIndex) {
  return {
    scenarioName: scenario.name,
    operationIndex,
    kind: step.kind,
    adapterClass: step.adapterClass ?? 'unknown',
    modulePath: step.modulePath,
    moduleAttributionReason: step.modulePath
      ? null
      : 'declaring module was not visible in the instrumented call stack',
    source: relativeTo(root, step.source),
    sourceType: pathType(step.source),
    target: relativeTo(root, step.target),
    targetType: pathType(step.target),
    summary: step.summary,
  }
}

function scenarioInventory(root, scenario) {
  const flags = parseProjectFlags(scenario.flags)
  const slug = flags['admin-console-slug'] ?? DEFAULT_ADMIN_CONSOLE_SLUG
  const plan = prepareProjectInit(root, flags, slug)
  const selectedProviders = Object.values(plan.desiredState.selected).filter(Boolean).length
  const facts = [
    ...plan.localeFacts,
    ...plan.sharedContentFacts,
    ...plan.storybookFacts,
    ...plan.consoleFacts,
  ]
  return {
    operations: plan.steps.map((step, index) => operationRecord(root, scenario, step, index)),
    migration: {
      productionProviders: selectedProviders,
      ownershipManifests: selectedProviders,
      semanticFacts: facts.length,
      semanticClaims: countAllSemanticClaims(facts),
      finalFilesystemOperations: plan.operationPlan.operationCount,
    },
  }
}

function sumMigration(plans) {
  const fields = Object.keys(plans[0].migration)
  return Object.fromEntries(
    fields.map((field) => [field, plans.reduce((total, plan) => total + plan.migration[field], 0)])
  )
}

export function buildOperationInventory() {
  const root = resolvePublicRepoRoot()
  const previousMeasurementMode = process.env.AMCORE_MEASURE_OPERATIONS
  process.env.AMCORE_MEASURE_OPERATIONS = '1'
  try {
    const plans = INVENTORY_SCENARIOS.map((scenario) => scenarioInventory(root, scenario))
    const operations = plans.flatMap((plan) => plan.operations)
    return {
      operations,
      exactCopyEdges: [],
      migrationCounts: sumMigration(plans),
    }
  } finally {
    if (previousMeasurementMode === undefined) delete process.env.AMCORE_MEASURE_OPERATIONS
    else process.env.AMCORE_MEASURE_OPERATIONS = previousMeasurementMode
  }
}
