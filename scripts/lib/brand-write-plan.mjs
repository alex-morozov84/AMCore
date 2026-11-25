import path from 'node:path'

import { BRAND_PATHS } from './brand-ownership.mjs'
import { readExternalRegularFile } from './external-file-snapshot.mjs'
import {
  absoluteEndpoint,
  inspectParents,
  normalizeEndpoint,
  resolveTransactionRoot,
} from './filesystem-transaction-paths.mjs'

const brandPaths = new Set(Object.values(BRAND_PATHS))

function readTarget(root, target) {
  inspectParents(root, target)
  try {
    return readExternalRegularFile(absoluteEndpoint(root, target), 'brand destination')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Brand destination is missing: ${target}. Restore the starter file and rerun.`,
        {
          cause: error,
        }
      )
    }
    throw error
  }
}

function sameFile(left, right) {
  return left.mode === right.mode && left.bytes.equals(right.bytes)
}

function changedSincePlan(target) {
  return new Error(`Brand destination changed: ${target}. Rerun to review a fresh plan.`)
}

function prepareWrite(root, realRoot, step, seen) {
  if (!['edit', 'copy'].includes(step.kind) || step.source) {
    throw new Error(`Unsupported brand operation: ${step.kind}`)
  }
  if (!path.isAbsolute(step.target)) throw new Error('Brand target must be absolute')
  const target = normalizeEndpoint(path.relative(root, step.target))
  if (!brandPaths.has(target) || absoluteEndpoint(root, target) !== path.resolve(step.target)) {
    throw new Error(`Unknown brand destination: ${target}`)
  }
  if (seen.has(target)) throw new Error(`Duplicate brand destination: ${target}`)
  seen.add(target)

  const before = readTarget(realRoot, target)
  if (step.kind === 'edit' && !before.bytes.equals(Buffer.from(step.before))) {
    throw changedSincePlan(target)
  }
  const operation = {
    kind: 'write',
    target,
    bytes: Buffer.from(step.kind === 'edit' ? step.after : step.bytes),
    mode: step.kind === 'edit' ? before.mode : step.mode,
  }
  return { before, operation, step }
}

export function buildBrandWritePlan({ root, materializedSteps }) {
  const absoluteRoot = path.resolve(root)
  const realRoot = resolveTransactionRoot(absoluteRoot)
  const seen = new Set()
  const destinations = materializedSteps.map((step) =>
    prepareWrite(absoluteRoot, realRoot, step, seen)
  )
  const writes = destinations.filter(({ before, operation }) => !sameFile(before, operation))
  return Object.freeze({
    displaySteps: Object.freeze(
      writes.map(({ step }) => Object.freeze({ ...step, changed: true }))
    ),
    operationCount: writes.length,
    assertFresh() {
      for (const { before, operation } of destinations) {
        if (!sameFile(before, readTarget(realRoot, operation.target))) {
          throw changedSincePlan(operation.target)
        }
      }
    },
    operationsForApply: () =>
      writes.map(({ operation }) => ({ ...operation, bytes: Buffer.from(operation.bytes) })),
  })
}
