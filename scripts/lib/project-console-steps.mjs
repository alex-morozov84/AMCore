import path from 'node:path'

import { materializeProjectContentPath } from './project-content-materializer.mjs'

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

function display(fact, step, summary) {
  return {
    ...step,
    provider: 'console',
    modulePath: 'scripts/lib/project-console-facts.mjs',
    summary,
    semanticFacts: [fact],
  }
}

function deleteStep(root, fact) {
  const step = { kind: 'delete', target: path.join(root, fact.path), changed: true }
  return display(fact, step, `delete console-owned ${fact.path}`)
}

function moveStep(root, fact, rewrite) {
  if (!rewrite) {
    const step = {
      kind: 'move',
      source: path.join(root, fact.from),
      target: path.join(root, fact.to),
      changed: true,
    }
    return display(fact, step, `move console ${fact.from}`)
  }
  const edit = materializeProjectContentPath(root, rewrite.path, [rewrite])
  const step = {
    ...edit,
    source: path.join(root, fact.from),
    target: path.join(root, fact.to),
    adapterClass: 'move-and-rewrite',
  }
  return display(rewrite, step, 'move console login and drop locale-resolution boilerplate')
}

export function materializeConsoleSteps(root, facts, sharedSteps) {
  const shared = new Set(sharedSteps.map((step) => relative(root, step.target)))
  const rewrites = new Map(
    facts.filter((fact) => fact.kind === 'content').map((fact) => [fact.path, fact])
  )
  const moveSources = new Set(facts.filter((fact) => fact.kind === 'move').map((fact) => fact.from))
  return facts.flatMap((fact) => {
    if (fact.kind === 'content' && (shared.has(fact.path) || moveSources.has(fact.path))) return []
    if (fact.kind === 'delete') return [deleteStep(root, fact)]
    if (fact.kind === 'move') return [moveStep(root, fact, rewrites.get(fact.from))]
    return [
      display(
        fact,
        materializeProjectContentPath(root, fact.path, [fact]),
        `apply Operations Console fact ${fact.operationKey}`
      ),
    ]
  })
}
