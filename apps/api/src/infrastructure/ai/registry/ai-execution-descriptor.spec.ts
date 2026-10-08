import { canonicalCompatibleEndpoint, endpointBinding } from './ai-execution-descriptor'
import type { ResolvedAiModel } from './ai-registry.types'

describe('compatible endpoint and built-in credential destination boundary', () => {
  it.each([
    'https://example.com/v1',
    'http://localhost:1234/v1',
    'http://127.0.0.1:1234/v1',
    'http://[::1]:1234/v1',
  ])('accepts explicit supported destination %s', (url) => {
    expect(canonicalCompatibleEndpoint(url + '/')).toBe(url)
  })
  it.each([
    null,
    'http://example.com/v1',
    'http://127.1/v1',
    'http://2130706433/v1',
    'http://0177.0.0.1/v1',
    'http://localhost.example/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?',
    'https://example.com/v1#',
    'https://example.com/\n',
    'file:///tmp/provider',
    'ftp://localhost/v1',
    'https://example.com/' + 'a'.repeat(2048),
  ])('rejects unsupported or ambiguous destination %s', (url) => {
    expect(() => canonicalCompatibleEndpoint(url)).toThrow()
  })
  it.each(['OPENAI', 'OPENROUTER', 'ANTHROPIC', 'YANDEX_AI_STUDIO', 'MOCK'] as const)(
    'built-in %s ignores any DB destination',
    (type) => {
      expect(
        endpointBinding({
          provider: { type, baseUrl: 'http://evil.example/?secret=1' },
        } as ResolvedAiModel)
      ).toEqual({ kind: 'built_in' })
    }
  )
  it('canonical digest ignores trailing slashes/default ports and changes on a new destination path', () => {
    const model = (baseUrl: string): ResolvedAiModel =>
      ({ provider: { type: 'OPENAI_COMPATIBLE', baseUrl } }) as ResolvedAiModel
    expect(endpointBinding(model('https://example.com:443/v1/'))).toEqual(
      endpointBinding(model('https://example.com/v1'))
    )
    expect(endpointBinding(model('https://example.com/v2'))).not.toEqual(
      endpointBinding(model('https://example.com/v1'))
    )
  })
})
