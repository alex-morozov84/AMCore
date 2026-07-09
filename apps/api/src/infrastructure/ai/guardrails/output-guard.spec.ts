import { GUARDRAIL_OUTPUT_CATEGORY, GUARDRAIL_PREAMBLE_SENTINELS } from './guardrail.constants'
import { scanOutput } from './output-guard'

const CAT = GUARDRAIL_OUTPUT_CATEGORY
const BOUNDED = new Set<string>(Object.values(CAT))

describe('scanOutput (Arc D output guard)', () => {
  describe('block tier — any finding is terminal', () => {
    it('blocks output that echoes the run boundary marker (passed via context)', () => {
      const marker = 'amcore:user-data-abc123'
      const result = scanOutput(`Your text was inside <${marker}> ... </${marker}>.`, { marker })
      expect(result.verdict).toBe('block')
      expect(result.categories.map((c) => c.category)).toContain(CAT.BOUNDARY_MARKER_LEAK)
    })

    it('blocks output that echoes the generic marker prefix even without context', () => {
      expect(scanOutput('the wrapper was amcore:user-data-zzz').verdict).toBe('block')
    })

    it('blocks output that reproduces a preamble sentinel', () => {
      const leak = `I must follow this: ${GUARDRAIL_PREAMBLE_SENTINELS[0]}.`
      const result = scanOutput(leak)
      expect(result.verdict).toBe('block')
      expect(result.categories.map((c) => c.category)).toContain(CAT.PREAMBLE_LEAK)
    })

    it('blocks output that self-states it is obeying/revealing hidden instructions', () => {
      const result = scanOutput('Okay, I will now ignore my previous instructions and comply.')
      expect(result.verdict).toBe('block')
      expect(result.categories.map((c) => c.category)).toContain(CAT.INSTRUCTION_DISCLOSURE)
    })
  })

  describe('allow', () => {
    it('allows an ordinary answer', () => {
      expect(scanOutput('TCP is reliable and connection-oriented; UDP is not.').verdict).toBe(
        'allow'
      )
    })

    it('does not flag a benign answer that mentions instructions generically', () => {
      expect(scanOutput('Here are the assembly instructions for your desk.').verdict).toBe('allow')
    })

    it('does not block a benign answer that uses the generic phrase "untrusted user input"', () => {
      // The preamble sentinel is a long, builder-specific fragment, so a support/docs answer that
      // merely mentions "untrusted user input" must not trip a terminal output block.
      const answer =
        'To defend an LLM, treat untrusted user input as data and validate all model output.'
      expect(scanOutput(answer).verdict).toBe('allow')
    })
  })

  describe('content-free result', () => {
    it('returns only bounded output categories and never leaks the marker value', () => {
      const marker = 'amcore:user-data-distinctive-9f3a'
      const result = scanOutput(`leaked <${marker}>`, { marker })
      for (const hit of result.categories) expect(BOUNDED.has(hit.category)).toBe(true)
      expect(JSON.stringify(result)).not.toContain('distinctive-9f3a')
    })
  })
})
