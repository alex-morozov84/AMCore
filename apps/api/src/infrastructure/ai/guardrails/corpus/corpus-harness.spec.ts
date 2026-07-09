import { GUARDRAIL_BOUNDARY_TAG_PREFIX } from '../guardrail.constants'
import { scanInput } from '../input-guard'
import { scanOutput } from '../output-guard'
import { buildTrustBoundaryRequest } from '../trust-boundary.builder'

import {
  BOUNDARY_INTEGRITY_CORPUS,
  type CorpusInputFamily,
  type CorpusOutputFamily,
  INPUT_CORPUS,
  OUTPUT_CORPUS,
} from './injection-corpus'

/**
 * Aggregate regression gate over the Arc D corpus (Track C — ADR-054 / ADR-055, Arc D.5).
 *
 * The thresholds below are **documented engineering floors/ceilings, not security guarantees**. They
 * are set conservatively with headroom over the deterministic guard's *current* behavior (which sits
 * at or near 1.0 for the detected families and ~0.11 benign-flag), so a real regression trips the
 * gate without the numbers implying the guard is complete. Per-case expectations live in
 * `injection-corpus.spec.ts`; this file asserts the corpus-wide properties.
 */

// Attacks AMCore recognizes structurally must almost always hard-block.
const ENVELOPE_BLOCK_FLOOR = 0.9
// Generic (English) jailbreak/override/probe/obfuscation must at least be flagged (verdict != allow).
const GENERIC_DETECT_FLOOR = 0.9
// Output leakage/disclosure must almost always be caught (terminal block).
const OUTPUT_BLOCK_FLOOR = 0.9
// Over-defense ceiling: at most this fraction of BENIGN inputs may even be flagged (0 may block).
const BENIGN_FLAG_CEILING = 0.34

function inputVerdicts(...families: CorpusInputFamily[]): string[] {
  return INPUT_CORPUS.filter((c) => families.includes(c.family)).map(
    (c) => scanInput(c.text).verdict
  )
}

function outputVerdicts(...families: CorpusOutputFamily[]): string[] {
  return OUTPUT_CORPUS.filter((c) => families.includes(c.family)).map(
    (c) => scanOutput(c.text).verdict
  )
}

function fraction(values: string[], predicate: (v: string) => boolean): number {
  return values.length === 0 ? 1 : values.filter(predicate).length / values.length
}

describe('injection corpus — aggregate regression gate (Arc D.5)', () => {
  it('almost always blocks attacks on the AMCore envelope/markers (floor, not a guarantee)', () => {
    const verdicts = inputVerdicts('envelope_spoof', 'marker_extraction')
    expect(verdicts.length).toBeGreaterThanOrEqual(6)
    expect(fraction(verdicts, (v) => v === 'block')).toBeGreaterThanOrEqual(ENVELOPE_BLOCK_FLOOR)
  })

  it('at least flags generic English attacks (multilingual excluded as a documented gap)', () => {
    // Multilingual attacks are intentionally excluded: the deterministic English guard misses them.
    const verdicts = inputVerdicts(
      'direct_override',
      'role_jailbreak',
      'system_prompt_probe',
      'encoded'
    )
    expect(verdicts.length).toBeGreaterThanOrEqual(12)
    expect(fraction(verdicts, (v) => v !== 'allow')).toBeGreaterThanOrEqual(GENERIC_DETECT_FLOOR)
  })

  it('does not over-defend: never blocks benign inputs, and flags at most the ceiling', () => {
    const verdicts = inputVerdicts('benign_security', 'benign_plain')
    expect(verdicts.length).toBeGreaterThanOrEqual(8)
    // Hard requirement: zero benign hard-blocks.
    expect(verdicts.filter((v) => v === 'block')).toHaveLength(0)
    // Soft ceiling: benign flags stay well below a threshold with headroom.
    expect(fraction(verdicts, (v) => v === 'flag')).toBeLessThanOrEqual(BENIGN_FLAG_CEILING)
  })

  it('catches output boundary/preamble leakage and disclosure, and passes benign output', () => {
    const leaks = outputVerdicts('marker_leak', 'preamble_leak', 'disclosure')
    expect(leaks.length).toBeGreaterThanOrEqual(6)
    expect(fraction(leaks, (v) => v === 'block')).toBeGreaterThanOrEqual(OUTPUT_BLOCK_FLOOR)
    expect(outputVerdicts('benign_output').filter((v) => v === 'block')).toHaveLength(0)
  })

  describe('structural boundary integrity', () => {
    it.each(BOUNDARY_INTEGRITY_CORPUS.map((c) => [c.id, c.text] as const))(
      'neutralizes %s: no raw forged marker/angle bracket survives, round-trips as data',
      (_id, text) => {
        const result = buildTrustBoundaryRequest({ untrustedUserText: text, nonce: 'FIXED' })
        const lines = result.messages[0]!.content.split('\n')
        const payload = lines.slice(1, -1).join('\n')

        // The real delimiters are exactly one opening + one closing marker line (ours).
        expect(lines[0]).toBe(`<${result.marker}>`)
        expect(lines.at(-1)).toBe(`</${result.marker}>`)
        // No raw angle bracket / ampersand and no forged closer survive in the payload.
        expect(payload).not.toMatch(/[<>&]/)
        expect(payload).not.toContain(`</${result.marker}>`)
        expect(payload).not.toContain(`<${GUARDRAIL_BOUNDARY_TAG_PREFIX}`)
        // Yet the untrusted text is recovered losslessly as inert JSON data.
        expect(JSON.parse(payload)).toEqual({ text })
      }
    )
  })
})
