import { matchesGlob } from './ownership-glob.mjs'

export function factMatches(inventory, fact) {
  return inventory.matches.get(fact) ?? []
}

export function filesForFacts(inventory, facts) {
  return new Set(facts.flatMap((fact) => factMatches(inventory, fact)))
}

export function filesInRoots(inventory) {
  return new Set([...inventory.rootFiles.values()].flat())
}

export function seamMatchesFile(seam, file) {
  return seam.path ? seam.path === file : matchesGlob(file, seam.glob)
}

export function isUnderRoots(file, roots) {
  return roots.some((root) => file === root || file.startsWith(`${root}/`))
}

export function pathsForSeams(inventory, seams) {
  return new Set(seams.flatMap((seam) => factMatches(inventory, seam)))
}
