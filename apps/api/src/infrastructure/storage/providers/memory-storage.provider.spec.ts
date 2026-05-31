import { runStorageProviderContract } from '../storage.contract-spec'

import { MemoryStorageProvider } from './memory-storage.provider'

describe('MemoryStorageProvider', () => {
  runStorageProviderContract('memory', () => new MemoryStorageProvider(), {
    signedUrls: false,
    publicUrls: false,
  })

  describe('reset', () => {
    it('clears all stored objects', async () => {
      const provider = new MemoryStorageProvider()
      await provider.upload({ key: 'r/1.txt', body: Buffer.from('1') })
      provider.reset()
      expect(await provider.exists('r/1.txt')).toBe(false)
    })
  })

  describe('etag', () => {
    it('is stable across uploads of identical content', async () => {
      const provider = new MemoryStorageProvider()
      const a = await provider.upload({ key: 'e/a.txt', body: Buffer.from('same') })
      const b = await provider.upload({ key: 'e/b.txt', body: Buffer.from('same') })
      expect(a.etag).toBeDefined()
      expect(a.etag).toBe(b.etag)
    })

    it('differs for different content', async () => {
      const provider = new MemoryStorageProvider()
      const a = await provider.upload({ key: 'e/c.txt', body: Buffer.from('one') })
      const b = await provider.upload({ key: 'e/d.txt', body: Buffer.from('two') })
      expect(a.etag).not.toBe(b.etag)
    })
  })

  describe('isolation', () => {
    it('does not share state between instances', async () => {
      const first = new MemoryStorageProvider()
      const second = new MemoryStorageProvider()
      await first.upload({ key: 'iso/1.txt', body: Buffer.from('1') })
      expect(await second.exists('iso/1.txt')).toBe(false)
    })
  })
})
