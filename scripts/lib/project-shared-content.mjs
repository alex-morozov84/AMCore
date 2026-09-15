import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { sharedDisplaySummary } from './project-shared-display.mjs'
import { SHARED_CONTENT_PATHS } from './project-shared-content-facts.mjs'

function groupFacts(facts) {
  const groups = new Map()
  for (const fact of facts) {
    const current = groups.get(fact.path) ?? []
    current.push(fact)
    groups.set(fact.path, current)
  }
  return groups
}

function cloneFact(fact) {
  return {
    ...fact,
    params: { ...fact.params },
    ...(fact.claims ? { claims: fact.claims.map((claim) => ({ ...claim })) } : {}),
  }
}

export function buildProjectSharedContentSteps(root, facts) {
  const groups = groupFacts(facts)
  return SHARED_CONTENT_PATHS.filter((pathname) => groups.has(pathname)).map((pathname) => {
    const pathFacts = groups.get(pathname)
    return {
      ...materializeProjectContentPath(root, pathname, pathFacts),
      adapterClass: 'semantic-shared-content',
      modulePath: 'scripts/lib/project-shared-content.mjs',
      summary: sharedDisplaySummary(pathname, pathFacts),
      semanticFacts: pathFacts.map(cloneFact),
    }
  })
}
