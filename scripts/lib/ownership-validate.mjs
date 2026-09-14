import { detectUndeclaredContributions } from './ownership-contributions.mjs'
import { assertNoRelevantUnresolvedReferences } from './ownership-dynamic.mjs'
import { createImportGraph } from './ownership-import-graph.mjs'
import { validateManifestInventory } from './ownership-inventory.mjs'
import { projectOwnership } from './ownership-projection.mjs'
import { validateSeams } from './ownership-seams.mjs'

export function validateOwnership(root, manifest, options = {}) {
  const inventory = validateManifestInventory(root, manifest)
  validateSeams(root, manifest, inventory)
  const graph = createImportGraph(root, manifest, inventory)
  const selection = { manifest, inventory }
  const projection = projectOwnership(graph, [selection])
  detectUndeclaredContributions(root, manifest, inventory, graph, options.changedFiles, projection)
  assertNoRelevantUnresolvedReferences(root, manifest, inventory, graph)
  return { inventory, graph, projection }
}
