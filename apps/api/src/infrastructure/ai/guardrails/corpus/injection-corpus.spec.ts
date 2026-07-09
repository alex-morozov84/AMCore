import { GUARDRAIL_INPUT_CATEGORY, GUARDRAIL_OUTPUT_CATEGORY } from '../guardrail.constants'
import type { GuardResult } from '../guardrail.types'
import { scanInput } from '../input-guard'
import { scanOutput } from '../output-guard'

import { INPUT_CORPUS, OUTPUT_CORPUS } from './injection-corpus'

/** Every bounded category code either guard may emit — for the content-free membership invariant. */
const BOUNDED = new Set<string>([
  ...Object.values(GUARDRAIL_INPUT_CATEGORY),
  ...Object.values(GUARDRAIL_OUTPUT_CATEGORY),
])

/** A per-output marker so leak cases have a concrete marker to echo. */
function markerFor(text: string): string | undefined {
  const match = text.match(/amcore:user-data-[A-Za-z0-9_-]+/)
  return match?.[0]
}

/** Structural content-free invariant: bounded codes + positive integer counts, and no raw input. */
function assertContentFree(result: GuardResult, sourceText: string): void {
  expect(Object.keys(result).sort()).toEqual(['categories', 'verdict'])
  for (const hit of result.categories) {
    expect(Object.keys(hit).sort()).toEqual(['category', 'count'])
    expect(BOUNDED.has(hit.category)).toBe(true)
    expect(Number.isInteger(hit.count) && hit.count > 0).toBe(true)
  }
  // The serialized result must not carry a distinctive slice of the source content.
  const slice = sourceText.replace(/\s+/g, ' ').slice(0, 24)
  if (slice.length >= 12) expect(JSON.stringify(result)).not.toContain(slice)
}

describe('injection corpus (Arc D.2 seed regression fixture)', () => {
  describe('INPUT_CORPUS via scanInput', () => {
    it.each(INPUT_CORPUS.map((c) => [c.id, c] as const))('%s', (_id, testCase) => {
      const result = scanInput(testCase.text)
      const acceptable = testCase.expect === 'not_block' ? ['allow', 'flag'] : [testCase.expect]
      expect(acceptable).toContain(result.verdict)
      assertContentFree(result, testCase.text)
    })

    it('never hard-blocks any benign case (over-defense guard)', () => {
      for (const testCase of INPUT_CORPUS.filter((c) => c.family.startsWith('benign'))) {
        expect(scanInput(testCase.text).verdict).not.toBe('block')
      }
    })
  })

  describe('OUTPUT_CORPUS via scanOutput', () => {
    it.each(OUTPUT_CORPUS.map((c) => [c.id, c] as const))('%s', (_id, testCase) => {
      const result = scanOutput(testCase.text, { marker: markerFor(testCase.text) })
      const acceptable = testCase.expect === 'not_block' ? ['allow', 'flag'] : [testCase.expect]
      expect(acceptable).toContain(result.verdict)
      assertContentFree(result, testCase.text)
    })
  })
})
