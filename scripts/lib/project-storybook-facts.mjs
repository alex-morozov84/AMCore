import { filesForFacts } from './ownership-facts.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import {
  assertStorybookOwnershipApplied,
  assertStorybookProjection,
  virtualStorybookSurface,
} from './project-storybook-residual.mjs'
import { storybookOwnership } from './storybook-ownership.mjs'

const content = (path, operationKey) => ({
  kind: 'content',
  dimension: 'storybook',
  path,
  operationKey,
  params: {},
})
const remove = (path) => ({ kind: 'delete', dimension: 'storybook', path })

export function buildStorybookContentFacts(state) {
  if (!state.selected.storybook) return []
  const seen = new Set()
  return storybookOwnership.seams.flatMap((seam) => {
    if (!seam.operationKey || seam.disposition === 'retain') return []
    const identity = `${seam.path}\0${seam.operationKey}`
    if (seen.has(identity)) return []
    seen.add(identity)
    return [content(seam.path, seam.operationKey)]
  })
}

function ownedDeletes(validation) {
  const roots = storybookOwnership.facts.roots.map((fact) => fact.path)
  const verification = [
    ...filesForFacts(validation.inventory, storybookOwnership.facts.verification),
  ].sort()
  const docs = [
    ...filesForFacts(validation.inventory, storybookOwnership.facts.documentation),
  ].sort()
  return [...new Set([...roots, ...verification, ...docs])].map(remove)
}

export function buildProjectStorybookFacts(root, state) {
  if (!state.selected.storybook) return { facts: [] }
  const validation = {
    ...validateOwnership(root, storybookOwnership),
    manifest: storybookOwnership,
  }
  return {
    facts: [...ownedDeletes(validation), ...buildStorybookContentFacts(state)],
    validation,
    virtualSurface: virtualStorybookSurface,
    assertProjection: assertStorybookProjection,
    assertApplied: () => assertStorybookOwnershipApplied(root, validation),
  }
}
