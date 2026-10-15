import { MemoryStorageProvider } from './providers/memory-storage.provider'
import {
  formatStorageCheck,
  runStorageCheck,
  type StorageCheckDeps,
  storageCheckPassed,
} from './storage-check.runner'

const unreachable = async (): Promise<never> => {
  throw new Error('no network in this test')
}

function deps(overrides: Partial<StorageCheckDeps> = {}): StorageCheckDeps {
  return {
    provider: new MemoryStorageProvider(),
    read: unreachable,
    send: unreachable,
    fetchBody: unreachable,
    publicBaseUrl: '',
    singleBucket: true,
    probePrefix: '__amcore_probes__',
    ...overrides,
  }
}

describe('runStorageCheck', () => {
  it('passes the private steps and skips what the driver cannot do', async () => {
    const steps = await runStorageCheck(deps())
    expect(steps.map((s) => [s.name, s.status])).toEqual([
      ['private upload, download, metadata and delete', 'ok'],
      ['presigned download and upload', 'skipped'],
      ['multipart upload', 'ok'],
      ['copy and list', 'ok'],
      ['public delivery and private exposure', 'skipped'],
      ['delete many and cleanup', 'ok'],
    ])
    expect(storageCheckPassed(steps)).toBe(true)
  })

  it('removes everything it created', async () => {
    const provider = new MemoryStorageProvider()
    await runStorageCheck(deps({ provider }))
    expect((await provider.list({ prefix: '' })).files).toEqual([])
  })

  it('reports a failing step by class and never leaks the provider message', async () => {
    const provider = new MemoryStorageProvider()
    jest.spyOn(provider, 'upload').mockRejectedValue(
      Object.assign(new Error('https://secret-bucket.internal.example.com denied key AKIA123'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      })
    )
    const steps = await runStorageCheck(deps({ provider }))
    expect(storageCheckPassed(steps)).toBe(false)
    const text = formatStorageCheck(steps)
    expect(text).toContain(
      'FAIL  private upload, download, metadata and delete — AccessDenied HTTP 403'
    )
    expect(text).not.toContain('secret-bucket')
    expect(text).not.toContain('AKIA123')
  })
})
