import {
  downloadAvatarSource,
  isAllowedAvatarSource,
  OAUTH_AVATAR_MAX_BYTES,
  OAuthAvatarError,
} from './oauth-avatar-source'

describe('isAllowedAvatarSource', () => {
  it.each([
    'https://lh3.googleusercontent.com/a/abc=s96-c',
    'https://avatars.githubusercontent.com/u/1?v=4',
  ])('allows the provider image host %s', (url) => {
    expect(isAllowedAvatarSource(url)).toBe(true)
  })

  it.each([
    'http://avatars.githubusercontent.com/u/1',
    'https://evil.example.com/a.png',
    'https://googleusercontent.com.evil.example.com/a.png',
    'https://avatars.githubusercontent.com.evil.test/u/1',
    'https://user:pw@avatars.githubusercontent.com/u/1',
    'https://avatars.githubusercontent.com:8443/u/1',
    'https://127.0.0.1/a.png',
    'https://169.254.169.254/latest/meta-data',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isAllowedAvatarSource(url)).toBe(false)
  })
})

describe('downloadAvatarSource', () => {
  const url = 'https://avatars.githubusercontent.com/u/1'
  const respond = (body: ConstructorParameters<typeof Response>[0], init: ResponseInit): void => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init))
  }
  afterEach(() => jest.restoreAllMocks())

  it('returns the bytes and type of an allowed image', async () => {
    respond(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png; charset=x' } })
    const file = await downloadAvatarSource(url)
    expect(file.mimetype).toBe('image/png')
    expect([...file.buffer]).toEqual([1, 2, 3])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ redirect: 'manual' })
    )
  })

  it('never contacts a host outside the allow-list', async () => {
    const spy = jest.spyOn(globalThis, 'fetch')
    await expect(downloadAvatarSource('https://evil.example.com/a.png')).rejects.toMatchObject({
      failure: 'host_not_allowed',
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses a redirect instead of following it', async () => {
    respond(null, { status: 302, headers: { location: 'https://evil.example.com/a.png' } })
    await expect(downloadAvatarSource(url)).rejects.toMatchObject({ failure: 'redirect' })
  })

  it('refuses a non-image type and an error status', async () => {
    respond('x', { headers: { 'content-type': 'text/html' } })
    await expect(downloadAvatarSource(url)).rejects.toMatchObject({ failure: 'bad_type' })
    respond('x', { status: 500 })
    await expect(downloadAvatarSource(url)).rejects.toMatchObject({ failure: 'bad_status' })
  })

  it('stops reading a body larger than the avatar size cap', async () => {
    respond(new Uint8Array(OAUTH_AVATAR_MAX_BYTES + 1), {
      headers: { 'content-type': 'image/png' },
    })
    await expect(downloadAvatarSource(url)).rejects.toMatchObject({ failure: 'too_large' })
  })

  it('reports a network failure as a class, not the underlying message', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1'))
    const error = await downloadAvatarSource(url).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OAuthAvatarError)
    expect((error as OAuthAvatarError).failure).toBe('request_failed')
    expect((error as Error).message).not.toContain('10.0.0.1')
  })
})
