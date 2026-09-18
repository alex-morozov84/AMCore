import { lstatSync } from 'node:fs'
import path from 'node:path'

import { normalizeRelativePath } from './path-algebra-normalize.mjs'
import { reducePathAlgebra } from './path-algebra-reduce.mjs'

function relative(root, target, label) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    throw new Error(`${label} must be an absolute materialized path`)
  }
  const pathname = path.relative(path.resolve(root), path.resolve(target))
  if (pathname.startsWith('..') || path.isAbsolute(pathname)) {
    throw new Error(`${label} escapes the transaction root: ${target}`)
  }
  return normalizeRelativePath(pathname)
}

function modeOf(target) {
  const stat = lstatSync(target)
  if (!stat.isFile()) throw new Error(`rewrite destination must be a regular file: ${target}`)
  return stat.mode & 0o7777
}

function createdFileMode(target) {
  try {
    return modeOf(target)
  } catch (error) {
    if (error.code === 'ENOENT') return 0o666 & ~process.umask()
    throw error
  }
}

function contentFact(root, step, dimension) {
  const bytes = Buffer.isBuffer(step.bytes)
    ? Buffer.from(step.bytes)
    : Buffer.from(String(step.after), 'utf8')
  return {
    kind: 'content',
    dimension,
    path: relative(root, step.target, `${step.kind} target`),
    bytes,
    mode: step.mode ?? modeOf(step.target),
  }
}

function factsForStep(root, step, index) {
  const dimension = `materialized:${index}`
  if (step.kind === 'delete') {
    return [{ kind: 'delete', dimension, path: relative(root, step.target, 'delete target') }]
  }
  if (step.kind === 'move') {
    return [
      {
        kind: 'move',
        dimension,
        from: relative(root, step.source, 'move source'),
        to: relative(root, step.target, 'move target'),
      },
    ]
  }
  if (step.kind === 'edit' && step.source) return moveEditFacts(root, step, dimension)
  if (step.kind === 'edit' || step.kind === 'copy') return [contentFact(root, step, dimension)]
  throw new Error(`materialized step #${index} has unsupported kind "${String(step.kind)}"`)
}

function moveEditFacts(root, step, dimension) {
  return [
    {
      kind: 'move',
      dimension,
      from: relative(root, step.source, 'edit source'),
      to: relative(root, step.target, 'edit target'),
    },
    contentFact(
      root,
      { ...step, target: step.source, mode: step.mode ?? createdFileMode(step.target) },
      dimension
    ),
  ]
}

function operationFromReduced(operation) {
  if (operation.kind === 'delete') return { kind: 'delete', target: operation.target }
  if (operation.kind === 'move') return moveOperation(operation)
  if (operation.facts.length !== 1) throw new Error(`duplicate writer: ${operation.target}`)
  const [fact] = operation.facts
  return {
    kind: 'write',
    target: operation.target,
    bytes: Buffer.from(fact.bytes),
    mode: fact.mode,
  }
}

function moveOperation(operation) {
  if (operation.carriedContent.length > 1) throw new Error(`duplicate writer: ${operation.to}`)
  const content = operation.carriedContent[0]
  return {
    kind: 'move',
    from: operation.from,
    to: operation.to,
    ...(content ? { bytes: Buffer.from(content.bytes), mode: content.mode } : {}),
  }
}

const cloneOperation = (operation) => ({
  ...operation,
  ...(operation.bytes ? { bytes: Buffer.from(operation.bytes) } : {}),
})

export function buildScaffoldOperationPlan({ root, materializedSteps }) {
  if (!Array.isArray(materializedSteps)) throw new Error('materializedSteps must be an array')
  const displaySteps = materializedSteps.filter((step) => step.changed)
  const facts = displaySteps.flatMap((step, index) => factsForStep(root, step, index))
  const snapshot = reducePathAlgebra(facts).map(operationFromReduced).map(cloneOperation)
  return Object.freeze({
    displaySteps: Object.freeze(displaySteps.map((step) => Object.freeze({ ...step }))),
    operationCount: snapshot.length,
    operationsForApply: () => snapshot.map(cloneOperation),
  })
}
