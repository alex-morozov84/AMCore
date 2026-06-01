import { buildDerivativeKey } from './media-key'

describe('buildDerivativeKey', () => {
  it('builds a stable version-less key', () => {
    expect(
      buildDerivativeKey({
        keyspace: 'avatars',
        ownerId: 'u1',
        variant: 'avatar-256',
        format: 'webp',
      })
    ).toBe('avatars/u1/avatar-256.webp')
  })

  it('inserts a v-<version> segment when a version is given', () => {
    expect(
      buildDerivativeKey({
        keyspace: 'avatars',
        ownerId: 'u1',
        version: 'abc123',
        variant: 'avatar-512',
        format: 'webp',
      })
    ).toBe('avatars/u1/v-abc123/avatar-512.webp')
  })

  it('maps jpeg output to a .jpg extension', () => {
    expect(
      buildDerivativeKey({
        keyspace: 'avatars',
        ownerId: 'u1',
        variant: 'avatar-128',
        format: 'jpeg',
      })
    ).toBe('avatars/u1/avatar-128.jpg')
  })

  it('is deterministic for identical parts', () => {
    const parts = {
      keyspace: 'avatars',
      ownerId: 'u1',
      variant: 'avatar-256',
      format: 'webp',
    } as const
    expect(buildDerivativeKey(parts)).toBe(buildDerivativeKey(parts))
  })

  it.each(['u1/other', '../etc', 'u1:x', 'u 1', 'u.1', ''])(
    'rejects an ownerId that is not a single safe segment: %p',
    (ownerId) => {
      expect(() =>
        buildDerivativeKey({ keyspace: 'avatars', ownerId, variant: 'avatar-256', format: 'webp' })
      ).toThrow(/ownerId/)
    }
  )

  it.each(['a/b', 'a:b', 'a b', 'a.b', '../x'])(
    'rejects a version that is not a single safe segment: %p',
    (version) => {
      expect(() =>
        buildDerivativeKey({
          keyspace: 'avatars',
          ownerId: 'u1',
          version,
          variant: 'avatar-256',
          format: 'webp',
        })
      ).toThrow(/version/)
    }
  )
})
