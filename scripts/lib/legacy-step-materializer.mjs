import { reducePathAlgebra } from './path-algebra-reduce.mjs'
import {
  legacyCreatedFileMode,
  legacyEndpoint,
  readExternalRegularFile,
} from './legacy-step-paths.mjs'

function requireText(step, field) {
  if (typeof step[field] !== 'string') throw new Error(`${step.kind} step requires string ${field}`)
  return step[field]
}

function contentFact(dimension, pathname, bytes, mode) {
  return { kind: 'content', dimension, path: pathname, bytes: Buffer.from(bytes), mode }
}

function editFacts(root, step, dimension) {
  const target = legacyEndpoint(root, step.target, 'edit target')
  const bytes = Buffer.from(requireText(step, 'after'), 'utf8')
  if (step.adapterClass !== 'move-and-rewrite') return [contentFact(dimension, target, bytes)]
  const source = legacyEndpoint(root, step.source, 'move source')
  return [
    { kind: 'move', dimension, from: source, to: target },
    contentFact(dimension, source, bytes, legacyCreatedFileMode(step.target)),
  ]
}

function copyFacts(root, step, dimension) {
  const target = legacyEndpoint(root, step.target, 'copy target')
  const snapshot = readExternalRegularFile(step.source)
  return [contentFact(dimension, target, snapshot.bytes, snapshot.mode)]
}

function factsForStep(root, step, index) {
  if (!step || typeof step !== 'object') throw new Error(`legacy step #${index} is missing`)
  const dimension = `legacy:${index}`
  if (step.kind === 'edit') return editFacts(root, step, dimension)
  if (step.kind === 'copy') return copyFacts(root, step, dimension)
  if (step.kind === 'move') {
    return [
      {
        kind: 'move',
        dimension,
        from: legacyEndpoint(root, step.source, 'move source'),
        to: legacyEndpoint(root, step.target, 'move target'),
      },
    ]
  }
  if (step.kind === 'delete') {
    return [{ kind: 'delete', dimension, path: legacyEndpoint(root, step.target, 'delete target') }]
  }
  throw new Error(`legacy step #${index} has unsupported kind "${String(step.kind)}"`)
}

function operationFromReduced(reduced) {
  if (reduced.kind === 'delete') return { kind: 'delete', target: reduced.target }
  if (reduced.kind === 'move') {
    if (reduced.carriedContent.length > 1)
      throw new Error(`duplicate effective writer: ${reduced.to}`)
    const carried = reduced.carriedContent[0]
    return {
      kind: 'move',
      from: reduced.from,
      to: reduced.to,
      ...(carried ? { bytes: Buffer.from(carried.bytes), mode: carried.mode } : {}),
    }
  }
  if (reduced.facts.length !== 1) throw new Error(`duplicate effective writer: ${reduced.target}`)
  const [fact] = reduced.facts
  return { kind: 'write', target: reduced.target, bytes: Buffer.from(fact.bytes), mode: fact.mode }
}

function displayStep(step) {
  const metadata = { ...step }
  delete metadata.write
  return Object.freeze({ ...metadata })
}

function cloneOperation(operation) {
  return { ...operation, ...(operation.bytes ? { bytes: Buffer.from(operation.bytes) } : {}) }
}

export function materializeLegacySteps(root, rawSteps) {
  if (!Array.isArray(rawSteps)) throw new Error('legacy steps must be an array')
  for (const [index, step] of rawSteps.entries()) {
    if (!step || typeof step !== 'object' || typeof step.changed !== 'boolean') {
      throw new Error(`legacy step #${index} requires boolean changed metadata`)
    }
  }
  const steps = rawSteps.filter((step) => step.changed)
  const facts = steps.flatMap((step, index) => factsForStep(root, step, index))
  const snapshot = reducePathAlgebra(facts).map(operationFromReduced).map(cloneOperation)
  return Object.freeze({
    displaySteps: Object.freeze(steps.map(displayStep)),
    operationCount: snapshot.length,
    operationsForApply: () => snapshot.map(cloneOperation),
  })
}
