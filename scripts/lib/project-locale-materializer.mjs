import path from 'node:path'

import { reducePathAlgebra } from './path-algebra-reduce.mjs'
import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { LOCALE_DISPLAY_ORDER } from './project-locale-display-order.mjs'

const absolute = (root, pathname) => path.join(root, pathname)

function semanticFacts(operation) {
  return operation.carriedContent ?? operation.facts ?? []
}

function summary(operation) {
  if (operation.kind === 'delete') return `delete ${operation.target}`
  if (operation.kind === 'move') return `move ${operation.from} -> ${operation.to}`
  return `update ${operation.target}`
}

function deleteStep(root, operation) {
  return {
    kind: 'delete',
    target: absolute(root, operation.target),
    changed: true,
    provider: 'locale',
    modulePath: 'scripts/lib/project-locale-materializer.mjs',
    summary: summary(operation),
  }
}

function moveStep(root, operation) {
  const facts = semanticFacts(operation)
  if (!facts.length) {
    return {
      kind: 'move',
      source: absolute(root, operation.from),
      target: absolute(root, operation.to),
      changed: true,
      provider: 'locale',
      modulePath: 'scripts/lib/project-locale-materializer.mjs',
      summary: summary(operation),
    }
  }
  const edit = materializeProjectContentPath(root, operation.to, facts, {
    sourcePath: operation.from,
  })
  return {
    ...edit,
    source: absolute(root, operation.from),
    provider: 'locale',
    adapterClass: 'semantic-structural-content',
    modulePath: 'scripts/lib/project-locale-materializer.mjs',
    summary: summary(operation),
    semanticFacts: facts,
  }
}

function contentStep(root, operation) {
  const facts = semanticFacts(operation)
  return {
    ...materializeProjectContentPath(root, operation.target, facts),
    provider: 'locale',
    adapterClass: 'semantic-structural-content',
    modulePath: 'scripts/lib/project-locale-materializer.mjs',
    summary: summary(operation),
    semanticFacts: facts,
  }
}

function orderForDisplay(operations) {
  const rank = new Map(LOCALE_DISPLAY_ORDER.map((pathname, index) => [pathname, index]))
  for (const operation of operations) {
    const pathname = operation.to ?? operation.target
    if (!rank.has(pathname)) throw new Error(`locale display order is missing ${pathname}`)
  }
  return operations.sort((left, right) => {
    const leftPath = left.to ?? left.target
    const rightPath = right.to ?? right.target
    return rank.get(leftPath) - rank.get(rightPath)
  })
}

export function materializeProjectLocaleSteps(root, facts) {
  const operations = orderForDisplay(reducePathAlgebra(facts))
  return operations.map((operation) => {
    if (operation.kind === 'delete') return deleteStep(root, operation)
    if (operation.kind === 'move') return moveStep(root, operation)
    return contentStep(root, operation)
  })
}
