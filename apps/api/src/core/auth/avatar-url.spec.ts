import { avatarUrlOf } from './avatar-url'

describe('avatarUrlOf', () => {
  const storage = { getPublicUrl: jest.fn((key: string) => `https://files.test/${key}`) }

  it('computes the URL from the stored key, so a new public base needs no data migration', () => {
    expect(avatarUrlOf(storage, 'public/avatars/u1/v-1-a/avatar-256.webp')).toBe(
      'https://files.test/public/avatars/u1/v-1-a/avatar-256.webp'
    )
  })

  it.each([null, undefined, ''])('returns null for no avatar (%p)', (key) => {
    expect(avatarUrlOf(storage, key)).toBeNull()
  })
})
