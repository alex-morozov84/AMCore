import path from 'node:path'

import { localeOwnership } from './locale-ownership.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { buildProjectLocaleFacts } from './project-locale-facts.mjs'
import { materializeProjectLocaleSteps } from './project-locale-materializer.mjs'
import { assertLocaleSemanticProjection } from './project-locale-semantic-validation.mjs'

const relative = (root, target) => path.relative(root, target).split(path.sep).join('/')

function projectedContents(root, steps) {
  const contents = new Map()
  for (const step of steps.filter((item) => item.kind === 'edit')) {
    const pathname = step.source ? relative(root, step.source) : relative(root, step.target)
    contents.set(pathname, step.after)
  }
  return contents
}

export function buildProjectLocalePlan(root, state) {
  const facts = buildProjectLocaleFacts(state)
  if (!facts.length) return { facts, steps: [] }
  const steps = materializeProjectLocaleSteps(root, facts)
  return { facts, steps }
}

export function validateProjectLocaleOwnership(root, steps, locale) {
  const contents = projectedContents(root, steps)
  const validation = {
    ...validateOwnership(root, localeOwnership, { contents }),
    manifest: localeOwnership,
  }
  assertLocaleSemanticProjection(locale, contents)
  return validation
}
