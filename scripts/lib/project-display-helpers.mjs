import path from 'node:path'

export function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

export function insertAt(plan, index, steps) {
  if (steps.length) plan.splice(index, 0, ...steps)
}

function targetIndex(plan, root, target) {
  const index = plan.findIndex((step) => relative(root, step.target) === target)
  if (index < 0) throw new Error(`display-plan anchor is missing: ${target}`)
  return index
}

export function insertTarget(plan, root, target, steps, offset = 0) {
  if (steps.length) insertAt(plan, targetIndex(plan, root, target) + offset, steps)
}

function providerBoundary(plan, provider, before) {
  const indexes = plan.flatMap((step, index) => (step.provider === provider ? [index] : []))
  if (!indexes.length) throw new Error(`display-plan provider is missing: ${provider}`)
  return before ? indexes[0] : indexes.at(-1) + 1
}

export function insertProvider(plan, provider, before, steps) {
  if (steps.length) insertAt(plan, providerBoundary(plan, provider, before), steps)
}

export function take(map, ...targets) {
  return targets.flatMap((target) => {
    const step = map.get(target)
    map.delete(target)
    return step ? [step] : []
  })
}

export function takeOwned(map, dimension, ...targets) {
  return targets.flatMap((target) => {
    const step = map.get(target)
    if (step?.semanticFacts[0].dimension !== dimension) return []
    map.delete(target)
    return [step]
  })
}
