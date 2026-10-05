import { aiRunInputFingerprint } from './ai-run-input-fingerprint'

describe('aiRunInputFingerprint', () => {
  const parts = [
    { type: 'text', text: 'hello' },
    { type: 'artifact_ref', artifactId: 'a1' },
  ]

  it('is versioned and stable across key order', () => {
    expect(aiRunInputFingerprint(parts)).toMatch(/^v1:[0-9a-f]{64}$/)
    expect(aiRunInputFingerprint(parts)).toBe(
      aiRunInputFingerprint([
        { text: 'hello', type: 'text' },
        { artifactId: 'a1', type: 'artifact_ref' },
      ])
    )
  })

  it('distinguishes differing text, artifact ids and part order', () => {
    const base = aiRunInputFingerprint(parts)
    expect(aiRunInputFingerprint([{ type: 'text', text: 'hello!' }, parts[1]])).not.toBe(base)
    expect(aiRunInputFingerprint([parts[0], { type: 'artifact_ref', artifactId: 'a2' }])).not.toBe(
      base
    )
    expect(aiRunInputFingerprint([parts[1], parts[0]])).not.toBe(base)
  })
})
