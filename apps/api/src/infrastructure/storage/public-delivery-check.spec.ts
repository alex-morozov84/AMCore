import {
  canaryKeys,
  checkPublicDelivery,
  ensureCanaries,
  PRIVATE_CANARY_BYTES,
  PUBLIC_CANARY_BYTES,
  type PublicDeliveryDeps,
} from './public-delivery-check'
import type { AnonymousRead, AnonymousResponse } from './storage-anonymous-read'

const PREFIX = '__amcore_probes__'
const PUBLIC_URL = 'https://cdn.example.com/public/__amcore_probes__/public-canary'
const API_URL = 'https://s3.example.com/private-bucket/__amcore_probes__/private-canary'
const BASE_URL = 'https://cdn.example.com/__amcore_probes__/private-canary'

type Responses = Record<string, AnonymousResponse | Error>

function makeDeps(
  responses: Responses,
  overrides: Partial<PublicDeliveryDeps> = {}
): { deps: PublicDeliveryDeps; requested: string[]; upload: jest.Mock } {
  const requested: string[] = []
  const read: AnonymousRead = async (url) => {
    requested.push(url)
    const response = responses[url]
    if (!response) throw new Error(`unexpected request ${url}`)
    if (response instanceof Error) throw response
    return response
  }
  const upload = jest.fn().mockResolvedValue({ key: 'k', size: 1 })
  const deps: PublicDeliveryDeps = {
    storage: {
      upload,
      getPublicUrl: jest.fn(() => PUBLIC_URL),
      getUnsignedObjectUrl: jest.fn(async () => API_URL),
    },
    read,
    publicBaseUrl: 'https://cdn.example.com',
    urlForm: 'bucket-root',
    singleBucket: false,
    probePrefix: PREFIX,
    ...overrides,
  }
  return { deps, requested, upload }
}

const served: AnonymousResponse = { status: 200, body: PUBLIC_CANARY_BYTES }
const status = (code: number, body = Buffer.alloc(0)): AnonymousResponse => ({ status: code, body })
const live = (): AbortSignal => new AbortController().signal

describe('public delivery check', () => {
  it('keeps the canaries in the reserved folder, the public one under public/', () => {
    expect(canaryKeys(PREFIX)).toEqual({
      publicKey: 'public/__amcore_probes__/public-canary',
      privateKey: '__amcore_probes__/private-canary',
    })
    expect(PUBLIC_CANARY_BYTES.equals(PRIVATE_CANARY_BYTES)).toBe(false)
  })

  it('writes both fixed canaries so a restart or a second instance repeats the same write', async () => {
    const { deps, upload } = makeDeps({})
    await ensureCanaries(deps)
    await ensureCanaries(deps)
    const keys = upload.mock.calls.map((call) => call[0].key)
    expect(keys).toEqual([
      'public/__amcore_probes__/public-canary',
      '__amcore_probes__/private-canary',
      'public/__amcore_probes__/public-canary',
      '__amcore_probes__/private-canary',
    ])
  })

  describe('public canary', () => {
    it('passes when it is served with its own bytes and the private canary is refused', async () => {
      const { deps } = makeDeps({ [PUBLIC_URL]: served, [API_URL]: status(403) })
      await expect(checkPublicDelivery(deps, live())).resolves.toEqual({ ok: true })
    })

    it.each([403, 404, 301])('reports not served for HTTP %i', async (code) => {
      const { deps } = makeDeps({ [PUBLIC_URL]: status(code) })
      await expect(checkPublicDelivery(deps, live())).resolves.toEqual({
        ok: false,
        stage: 'public_read',
        failure: 'public_not_served',
        status: code,
      })
    })

    it('reports a server error as unreachable, not as unpublished', async () => {
      const { deps } = makeDeps({ [PUBLIC_URL]: status(502) })
      await expect(checkPublicDelivery(deps, live())).resolves.toMatchObject({
        stage: 'public_read',
        failure: 'public_unreachable',
        status: 502,
      })
    })

    it('reports a network error as unreachable and an abort as a timeout', async () => {
      const unreachable = makeDeps({ [PUBLIC_URL]: new Error('ECONNREFUSED') })
      await expect(checkPublicDelivery(unreachable.deps, live())).resolves.toMatchObject({
        failure: 'public_unreachable',
      })
      const controller = new AbortController()
      const slow = makeDeps({ [PUBLIC_URL]: new Error('aborted') })
      controller.abort()
      await expect(checkPublicDelivery(slow.deps, controller.signal)).resolves.toMatchObject({
        failure: 'timeout',
      })
    })

    it('reports other bytes as a content mismatch', async () => {
      const { deps } = makeDeps({ [PUBLIC_URL]: { status: 200, body: Buffer.from('<html>') } })
      await expect(checkPublicDelivery(deps, live())).resolves.toMatchObject({
        stage: 'public_read',
        failure: 'content_mismatch',
      })
    })
  })

  describe('private canary through the storage API', () => {
    it.each([401, 403, 404])('treats HTTP %i as refused', async (code) => {
      const { deps } = makeDeps({ [PUBLIC_URL]: served, [API_URL]: status(code) })
      await expect(checkPublicDelivery(deps, live())).resolves.toEqual({ ok: true })
    })

    it('reports an exposure when the unsigned read succeeds', async () => {
      const { deps } = makeDeps({
        [PUBLIC_URL]: served,
        [API_URL]: { status: 200, body: PRIVATE_CANARY_BYTES },
      })
      await expect(checkPublicDelivery(deps, live())).resolves.toEqual({
        ok: false,
        stage: 'private_exposed_api',
        failure: 'private_exposed',
        status: 200,
      })
    })

    it('does not call a server error an exposure', async () => {
      const { deps } = makeDeps({ [PUBLIC_URL]: served, [API_URL]: status(500) })
      await expect(checkPublicDelivery(deps, live())).resolves.toMatchObject({
        stage: 'private_exposed_api',
        failure: 'check_error',
        status: 500,
      })
    })

    it('skips the step for a driver without an unsigned address', async () => {
      const { deps, requested } = makeDeps({ [PUBLIC_URL]: served })
      delete deps.storage.getUnsignedObjectUrl
      await expect(checkPublicDelivery(deps, live())).resolves.toEqual({ ok: true })
      expect(requested).toEqual([PUBLIC_URL])
    })
  })

  describe('private canary through the public base (one bucket)', () => {
    it('is requested only when one bucket holds both namespaces', async () => {
      const two = makeDeps({ [PUBLIC_URL]: served, [API_URL]: status(403) })
      await checkPublicDelivery(two.deps, live())
      expect(two.requested).not.toContain(BASE_URL)

      const one = makeDeps(
        { [PUBLIC_URL]: served, [API_URL]: status(403), [BASE_URL]: status(403) },
        { singleBucket: true }
      )
      await expect(checkPublicDelivery(one.deps, live())).resolves.toEqual({ ok: true })
      expect(one.requested).toContain(BASE_URL)
    })

    it('reports an exposure when the public base serves the private canary', async () => {
      const { deps } = makeDeps(
        {
          [PUBLIC_URL]: served,
          [API_URL]: status(403),
          [BASE_URL]: { status: 200, body: PRIVATE_CANARY_BYTES },
        },
        { singleBucket: true }
      )
      await expect(checkPublicDelivery(deps, live())).resolves.toEqual({
        ok: false,
        stage: 'private_exposed_base',
        failure: 'private_exposed',
        status: 200,
      })
    })
  })
})

describe('public delivery check, route form (api mode and local driver)', () => {
  const ROUTE_PUBLIC =
    'https://api.example.com/api/v1/storage/public?key=public%2F__amcore_probes__%2Fpublic-canary'
  const ROUTE_PRIVATE =
    'https://api.example.com/api/v1/storage/public?key=__amcore_probes__%2Fprivate-canary'

  function routeDeps(responses: Responses, overrides: Partial<PublicDeliveryDeps> = {}) {
    return makeDeps(responses, {
      urlForm: 'route',
      publicBaseUrl: 'https://api.example.com/api/v1/storage/public',
      singleBucket: false,
      ...overrides,
      storage: {
        upload: jest.fn(),
        getPublicUrl: jest.fn(() => ROUTE_PUBLIC),
        getUnsignedObjectUrl: jest.fn(async () => API_URL),
      },
    })
  }

  it('asks the route for the private canary even with two buckets, in the route address form', async () => {
    const { deps, requested } = routeDeps({
      [ROUTE_PUBLIC]: served,
      [API_URL]: status(403),
      [ROUTE_PRIVATE]: status(404),
    })
    await expect(checkPublicDelivery(deps, live())).resolves.toEqual({ ok: true })
    expect(requested).toContain(ROUTE_PRIVATE)
  })

  it('reports an exposure when the route would serve a private key', async () => {
    const { deps } = routeDeps({
      [ROUTE_PUBLIC]: served,
      [API_URL]: status(403),
      [ROUTE_PRIVATE]: { status: 200, body: PRIVATE_CANARY_BYTES },
    })
    await expect(checkPublicDelivery(deps, live())).resolves.toEqual({
      ok: false,
      stage: 'private_exposed_base',
      failure: 'private_exposed',
      status: 200,
    })
  })

  it('does not call a route that fails to answer an exposure', async () => {
    const { deps } = routeDeps({
      [ROUTE_PUBLIC]: served,
      [API_URL]: status(403),
      [ROUTE_PRIVATE]: status(502),
    })
    await expect(checkPublicDelivery(deps, live())).resolves.toMatchObject({
      stage: 'private_exposed_base',
      failure: 'check_error',
      status: 502,
    })
  })

  it('keeps the bucket-root address unasked in route form (it would hit the route without a key)', async () => {
    const { deps, requested } = routeDeps({
      [ROUTE_PUBLIC]: served,
      [API_URL]: status(403),
      [ROUTE_PRIVATE]: status(404),
    })
    await checkPublicDelivery(deps, live())
    expect(requested).not.toContain(
      'https://api.example.com/api/v1/storage/public/__amcore_probes__/private-canary'
    )
  })
})
