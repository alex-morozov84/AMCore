import { filesForFacts, filesInRoots, pathsForSeams } from './ownership-facts.mjs'

function unionFacts(selections, field) {
  const output = new Set()
  for (const { manifest, inventory } of selections) {
    for (const file of filesForFacts(inventory, manifest.facts[field])) output.add(file)
  }
  return output
}

function baseRemoved(selections) {
  const removed = new Set()
  for (const selection of selections) {
    for (const file of filesInRoots(selection.inventory)) removed.add(file)
  }
  for (const field of ['featureFiles', 'topology', 'verification', 'documentation']) {
    for (const file of unionFacts(selections, field)) removed.add(file)
  }
  return removed
}

function removedEdgeKeys(selections) {
  const keys = new Set()
  for (const { manifest, inventory } of selections) {
    const seams = manifest.seams.filter((seam) => seam.disposition === 'remove')
    for (const seam of seams) {
      for (const source of pathsForSeams(inventory, [seam])) {
        for (const target of seam.removeImports ?? []) keys.add(`${source}\0${target}`)
      }
    }
  }
  return keys
}

function projectedForward(graph, removed, edgeKeys) {
  const forward = new Map()
  for (const [source, edges] of graph.forward) {
    if (removed.has(source)) continue
    const kept = edges.filter(
      (edge) => !removed.has(edge.target) && !edgeKeys.has(`${source}\0${edge.target}`)
    )
    forward.set(source, kept)
  }
  return forward
}

function reachableFrom(entrypoints, forward) {
  const reachable = new Set()
  const pending = [...entrypoints]
  while (pending.length) {
    const current = pending.pop()
    if (reachable.has(current) || !forward.has(current)) continue
    reachable.add(current)
    for (const edge of forward.get(current)) pending.push(edge.target)
  }
  return reachable
}

function reverseGraph(forward) {
  const reverse = new Map([...forward.keys()].map((file) => [file, []]))
  for (const [source, edges] of forward) {
    for (const edge of edges) reverse.get(edge.target)?.push({ ...edge, importer: source })
  }
  return reverse
}

function removeDeadModuleTests(selections, dead, removed) {
  for (const { manifest, inventory } of selections) {
    for (const fact of manifest.facts.sharedModuleTests) {
      if (!dead.has(fact.module)) continue
      for (const file of inventory.matches.get(fact)) removed.add(file)
    }
  }
}

function productionOrigins(graph, entrypoints, removed) {
  return [...entrypoints].filter(
    (file) => !removed.has(file) && graph.kinds.get(file) !== 'test' && !graph.barrels.has(file)
  )
}

export function projectOwnership(graph, selections) {
  const removed = baseRemoved(selections)
  const edgeKeys = removedEdgeKeys(selections)
  const firstPass = projectedForward(graph, removed, edgeKeys)
  const entrypoints = unionFacts(selections, 'repositoryEntrypoints')
  const origins = productionOrigins(graph, entrypoints, removed)
  const reachable = reachableFrom(origins, firstPass)
  const candidates = unionFacts(selections, 'sharedModules')
  const deadSharedModules = new Set([...candidates].filter((file) => !reachable.has(file)))
  for (const file of deadSharedModules) removed.add(file)
  removeDeadModuleTests(selections, deadSharedModules, removed)
  const forward = projectedForward(graph, removed, edgeKeys)
  return {
    removed,
    forward,
    reverse: reverseGraph(forward),
    reachable: reachableFrom(origins, forward),
    deadSharedModules,
    universalSharedModules: new Set([...candidates].filter((file) => reachable.has(file))),
  }
}
