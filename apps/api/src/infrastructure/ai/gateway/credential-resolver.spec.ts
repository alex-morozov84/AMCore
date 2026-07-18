import { AiCredentialResolver } from './credential-resolver'

import type { EnvService } from '@/env/env.service'
import { AiProviderType } from '@/generated/prisma/client'

/**
 * Unit tests for the code-owned credential allowlist (Track C — ADR-054, Arc B). The
 * load-bearing property: a catalog `credentialSlot` is mapped to a FIXED env key per provider
 * type and never indexes `process.env` directly, so an unknown/hostile slot cannot reach an
 * unrelated secret. Fail-closed on every unknown input.
 */

function makeResolver(envValues: Record<string, string | undefined>): AiCredentialResolver {
  const env = {
    get: (key: string): string | undefined => envValues[key],
  } as unknown as EnvService
  return new AiCredentialResolver(env)
}

describe('AiCredentialResolver', () => {
  describe('resolveEnvKey', () => {
    it('maps an allowlisted (type, slot) to its fixed env key', () => {
      const resolver = makeResolver({})
      expect(resolver.resolveEnvKey(AiProviderType.ANTHROPIC, 'default')).toBe('ANTHROPIC_API_KEY')
      expect(resolver.resolveEnvKey(AiProviderType.YANDEX_AI_STUDIO, 'default')).toBe(
        'YANDEX_API_KEY'
      )
    })

    it('returns null for an unknown slot (fail closed)', () => {
      const resolver = makeResolver({})
      expect(resolver.resolveEnvKey(AiProviderType.ANTHROPIC, 'JWT_SECRET')).toBeNull()
      expect(resolver.resolveEnvKey(AiProviderType.ANTHROPIC, 'secondary')).toBeNull()
    })

    it('returns null for a null slot and for the credential-less MOCK provider', () => {
      const resolver = makeResolver({})
      expect(resolver.resolveEnvKey(AiProviderType.ANTHROPIC, null)).toBeNull()
      expect(resolver.resolveEnvKey(AiProviderType.MOCK, 'default')).toBeNull()
    })
  })

  describe('requiresCredential', () => {
    it('is false only for MOCK', () => {
      const resolver = makeResolver({})
      expect(resolver.requiresCredential(AiProviderType.MOCK)).toBe(false)
      expect(resolver.requiresCredential(AiProviderType.ANTHROPIC)).toBe(true)
      expect(resolver.requiresCredential(AiProviderType.OPENAI_COMPATIBLE)).toBe(true)
    })
  })

  describe('getCredential', () => {
    it('returns the secret only via the allowlisted key', () => {
      const resolver = makeResolver({ ANTHROPIC_API_KEY: 'sk-aB0_-Zz9' })
      expect(resolver.getCredential(AiProviderType.ANTHROPIC, 'default')).toBe('sk-aB0_-Zz9')
    })

    it('never reads an unrelated env var for a hostile slot', () => {
      const resolver = makeResolver({
        JWT_SECRET: 'super-secret',
        ANTHROPIC_API_KEY: 'sk-aB0_-Zz9',
      })
      expect(resolver.getCredential(AiProviderType.ANTHROPIC, 'JWT_SECRET')).toBeNull()
    })

    it('returns null when the allowlisted key is unset or empty', () => {
      expect(makeResolver({}).getCredential(AiProviderType.OPENAI, 'default')).toBeNull()
      expect(
        makeResolver({ OPENAI_API_KEY: '' }).getCredential(AiProviderType.OPENAI, 'default')
      ).toBeNull()
    })
  })

  describe('hasCredential', () => {
    it('is always true for the credential-less MOCK provider', () => {
      expect(makeResolver({}).hasCredential(AiProviderType.MOCK, null)).toBe(true)
    })

    it('reflects key presence for a real provider', () => {
      expect(
        makeResolver({ ANTHROPIC_API_KEY: 'sk-aB0_-Zz9' }).hasCredential(
          AiProviderType.ANTHROPIC,
          'default'
        )
      ).toBe(true)
      expect(makeResolver({}).hasCredential(AiProviderType.ANTHROPIC, 'default')).toBe(false)
      expect(
        makeResolver({ ANTHROPIC_API_KEY: 'sk-aB0_-Zz9' }).hasCredential(
          AiProviderType.ANTHROPIC,
          null
        )
      ).toBe(false)
    })
  })
})
