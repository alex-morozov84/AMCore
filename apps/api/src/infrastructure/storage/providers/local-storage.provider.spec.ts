import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runStorageProviderContract } from '../storage.contract-spec'

import { LocalStorageProvider } from './local-storage.provider'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-storage-'))
  roots.push(root)
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('LocalStorageProvider', () => {
  runStorageProviderContract('local', () => new LocalStorageProvider({ root: makeRoot() }), {
    signedUrls: false,
    publicUrls: false,
  })

  describe('filesystem behavior', () => {
    it('creates nested directories on upload', async () => {
      const provider = new LocalStorageProvider({ root: makeRoot() })
      await provider.upload({ key: 'deep/nested/dir/file.bin', body: Buffer.from('data') })
      expect((await provider.download('deep/nested/dir/file.bin')).toString()).toBe('data')
    })

    it('persists visibility to a sidecar under the reserved meta dir', async () => {
      const root = makeRoot()
      const provider = new LocalStorageProvider({ root })
      await provider.upload({ key: 'a/p.txt', body: Buffer.from('x'), visibility: 'public-read' })
      const raw = await readFile(path.join(root, 'meta', 'a', 'p.txt.json'), 'utf8')
      expect(JSON.parse(raw).visibility).toBe('public-read')
    })

    it('lists only object keys (metadata is stored out of the key namespace)', async () => {
      const provider = new LocalStorageProvider({ root: makeRoot() })
      await provider.upload({ key: 'docs/a.txt', body: Buffer.from('a') })
      const { files } = await provider.list({ prefix: '' })
      expect(files.map((f) => f.key)).toEqual(['docs/a.txt'])
    })

    it('treats a key ending in .meta.json as an ordinary object', async () => {
      const provider = new LocalStorageProvider({ root: makeRoot() })
      await provider.upload({ key: 'report', body: Buffer.from('R') })
      await provider.upload({ key: 'report.meta.json', body: Buffer.from('M') })
      expect((await provider.download('report')).toString()).toBe('R')
      expect((await provider.download('report.meta.json')).toString()).toBe('M')
      const { files } = await provider.list({ prefix: '' })
      expect(files.map((f) => f.key).sort()).toEqual(['report', 'report.meta.json'])
    })

    it('returns an empty listing when the root does not exist yet', async () => {
      const provider = new LocalStorageProvider({ root: path.join(makeRoot(), 'not-created') })
      expect(await provider.list({ prefix: '' })).toEqual({ files: [], isTruncated: false })
    })
  })

  describe('public URLs', () => {
    it('reports publicUrls=true and builds a clean url when a base is configured', () => {
      // The base is expected to be a static mount of `<root>/objects`, so the
      // URL is `${base}/${key}` with no internal `objects/`/`meta/` segment.
      const provider = new LocalStorageProvider({
        root: makeRoot(),
        publicBaseUrl: 'https://cdn.example.com/assets/',
      })
      expect(provider.capabilities.publicUrls).toBe(true)
      expect(provider.getPublicUrl('avatars/u1.webp')).toBe(
        'https://cdn.example.com/assets/avatars/u1.webp'
      )
    })

    it('throws on getPublicUrl when no base is configured', () => {
      const provider = new LocalStorageProvider({ root: makeRoot() })
      expect(provider.capabilities.publicUrls).toBe(false)
      expect(() => provider.getPublicUrl('x.txt')).toThrow()
    })
  })
})
