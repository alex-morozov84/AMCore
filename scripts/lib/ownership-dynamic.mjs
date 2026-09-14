import { OWNERSHIP_CODES, ownershipError } from './ownership-errors.mjs'
import { relevantFiles } from './ownership-contributions.mjs'

export function assertNoRelevantUnresolvedReferences(root, manifest, inventory, graph) {
  const relevant = relevantFiles(root, manifest, inventory, graph)
  const dynamic = graph.dynamic.filter((item) => relevant.has(item.importer))
  const unresolved = graph.unresolved.filter((item) => relevant.has(item.importer) && item.dynamic)
  const blocked = [...dynamic, ...unresolved]
  if (!blocked.length) return
  throw ownershipError(
    OWNERSHIP_CODES.DYNAMIC_REFERENCE,
    `cannot resolve relevant dynamic references in ${blocked.map((item) => item.importer).join(', ')}`,
    blocked.map((item) => item.importer)
  )
}
