import type { PinoLogger } from 'nestjs-pino'

import type { AvatarService } from '../avatar.service'

import { OAuthAvatarRehostService } from './oauth-avatar-rehost.service'

describe('OAuthAvatarRehostService', () => {
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const avatars = { setAvatarIfAbsent: jest.fn() }
  const service = new OAuthAvatarRehostService(
    avatars as unknown as AvatarService,
    logger as unknown as PinoLogger
  )
  const url = 'https://avatars.githubusercontent.com/u/1'

  beforeEach(() => {
    jest.clearAllMocks()
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
      )
  })
  afterEach(() => jest.restoreAllMocks())

  it('stores the picture when the user has no avatar', async () => {
    avatars.setAvatarIfAbsent.mockResolvedValue('https://files.test/a.webp')
    await expect(service.rehost('u1', url)).resolves.toBe('stored')
    expect(avatars.setAvatarIfAbsent).toHaveBeenCalledWith('u1', {
      buffer: Buffer.from([1]),
      mimetype: 'image/png',
    })
  })

  it('skips quietly when an avatar already exists', async () => {
    avatars.setAvatarIfAbsent.mockResolvedValue(null)
    await expect(service.rehost('u1', url)).resolves.toBe('skipped')
  })

  it('never throws: a processing failure is logged as a class and the user stays without avatar', async () => {
    avatars.setAvatarIfAbsent.mockRejectedValue(new Error('sharp: bad image'))
    await expect(service.rehost('u1', url)).resolves.toBe('failed')
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: 'u1', result: 'failed', failure: 'processing_failed' },
      'oauth avatar rehost'
    )
  })

  it('does not download from a foreign host', async () => {
    await expect(service.rehost('u1', 'https://evil.example.com/a.png')).resolves.toBe('failed')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(avatars.setAvatarIfAbsent).not.toHaveBeenCalled()
  })
})
