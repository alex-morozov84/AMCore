// AMCore observability contract — the public/private-boundary ratchet.
// Fails on any private-path citation not present in the committed baseline
// at its exact (file, target) count; a baseline entry may only shrink.
import { readFileSync } from 'node:fs'

import { scanRepoForPrivatePathCitations } from './extract/private-paths.mjs'

/**
 * @param {{file:string, target:string, line:number}[]} hits - from scanRepoForPrivatePathCitations()
 * @param {{entries:{file:string, target:string, count:number, kind:string}[]}} baseline
 * @returns {string[]} violation messages; empty means clean
 */
export function validatePrivatePathBoundary(hits, baseline) {
  const liveCounts = new Map()
  for (const h of hits) {
    const key = `${h.file} ${h.target}`
    liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1)
  }
  const baselineCounts = new Map(baseline.entries.map((e) => [`${e.file} ${e.target}`, e.count]))

  const violations = []
  for (const [key, liveCount] of liveCounts) {
    const allowed = baselineCounts.get(key) ?? 0
    if (liveCount > allowed) {
      const [file, target] = key.split(' ')
      violations.push(
        `${file}: ${liveCount} occurrence(s) of "${target}" exceed the baseline's ${allowed} — ` +
          `a new or increased private-path citation must be removed, not added to the baseline`
      )
    }
  }
  return violations.sort()
}

export function loadBaseline(baselinePath) {
  return JSON.parse(readFileSync(baselinePath, 'utf8'))
}

export function runAgainstRealRepo(
  baselinePath = new URL('./private-path-baseline.json', import.meta.url)
) {
  const hits = scanRepoForPrivatePathCitations()
  const baseline = loadBaseline(baselinePath)
  return validatePrivatePathBoundary(hits, baseline)
}
