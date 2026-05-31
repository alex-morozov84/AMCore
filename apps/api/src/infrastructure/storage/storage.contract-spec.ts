/**
 * Shared behavioral contract for `StorageProvider`.
 *
 * Not a standalone test — the filename is intentionally `.contract-spec.ts`
 * (not `.spec.ts`) so Jest does not collect it on its own. Each provider's spec
 * imports {@link runStorageProviderContract} and runs it against a fresh
 * instance, so memory (now) and local/s3 (later) all satisfy the same behavior.
 *
 * Capability-gated behavior (signed/public URLs) is asserted from `options`:
 * a provider that reports a capability `false` must fail clearly when the
 * corresponding method is called.
 */

import { Readable } from 'node:stream'

import { InvalidObjectKeyError } from './object-key'
import type { StorageProvider } from './storage.interface'

export interface StorageContractOptions {
  signedUrls: boolean
  publicUrls: boolean
}

export function runStorageProviderContract(
  name: string,
  createProvider: () => StorageProvider,
  options: StorageContractOptions
): void {
  describe(`StorageProvider contract: ${name}`, () => {
    let provider: StorageProvider

    beforeEach(() => {
      provider = createProvider()
    })

    describe('upload + download', () => {
      it('stores a Buffer body and downloads it back', async () => {
        const body = Buffer.from('hello world')
        const result = await provider.upload({ key: 'docs/a.txt', body, contentType: 'text/plain' })
        expect(result.key).toBe('docs/a.txt')
        expect(result.size).toBe(body.length)
        expect(result.contentType).toBe('text/plain')
        expect((await provider.download('docs/a.txt')).equals(body)).toBe(true)
      })

      it('never returns a url on the upload result', async () => {
        const result = await provider.upload({ key: 'docs/b.txt', body: Buffer.from('x') })
        expect(result).not.toHaveProperty('url')
      })

      it('stores a Readable body', async () => {
        const body = Buffer.from('streamed bytes')
        await provider.upload({ key: 'docs/stream.bin', body: Readable.from(body) })
        expect((await provider.download('docs/stream.bin')).equals(body)).toBe(true)
      })

      it('overwrites an existing key', async () => {
        await provider.upload({ key: 'docs/c.txt', body: Buffer.from('v1') })
        await provider.upload({ key: 'docs/c.txt', body: Buffer.from('v2') })
        expect((await provider.download('docs/c.txt')).toString()).toBe('v2')
      })
    })

    describe('downloadStream', () => {
      it('returns a Readable stream of the body', async () => {
        const body = Buffer.from('stream me')
        await provider.upload({ key: 'docs/d.txt', body })
        const stream = await provider.downloadStream('docs/d.txt')
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk as Buffer)
        expect(Buffer.concat(chunks).equals(body)).toBe(true)
      })
    })

    describe('getMetadata', () => {
      it('returns content length and type', async () => {
        const body = Buffer.from('metadata')
        await provider.upload({ key: 'docs/e.txt', body, contentType: 'text/plain' })
        const meta = await provider.getMetadata('docs/e.txt')
        expect(meta.contentLength).toBe(body.length)
        expect(meta.contentType).toBe('text/plain')
      })

      it('rejects for a missing key', async () => {
        await expect(provider.getMetadata('docs/missing.txt')).rejects.toThrow()
      })
    })

    describe('visibility (private by default)', () => {
      it('defaults to private when omitted', async () => {
        await provider.upload({ key: 'v/private.txt', body: Buffer.from('p') })
        expect((await provider.getMetadata('v/private.txt')).visibility).toBe('private')
      })

      it('persists an explicit public-read visibility', async () => {
        await provider.upload({
          key: 'v/public.txt',
          body: Buffer.from('p'),
          visibility: 'public-read',
        })
        expect((await provider.getMetadata('v/public.txt')).visibility).toBe('public-read')
      })
    })

    describe('exists / delete', () => {
      it('reports existence', async () => {
        await provider.upload({ key: 'x/1.txt', body: Buffer.from('1') })
        expect(await provider.exists('x/1.txt')).toBe(true)
        expect(await provider.exists('x/none.txt')).toBe(false)
      })

      it('deletes a key', async () => {
        await provider.upload({ key: 'x/2.txt', body: Buffer.from('2') })
        await provider.delete('x/2.txt')
        expect(await provider.exists('x/2.txt')).toBe(false)
      })

      it('delete is idempotent for a missing key', async () => {
        await expect(provider.delete('x/missing.txt')).resolves.toBeUndefined()
      })
    })

    describe('deleteMany', () => {
      it('deletes all listed keys and resolves to void', async () => {
        await provider.upload({ key: 'm/a.txt', body: Buffer.from('a') })
        await provider.upload({ key: 'm/b.txt', body: Buffer.from('b') })
        const result = await provider.deleteMany(['m/a.txt', 'm/b.txt', 'm/missing.txt'])
        expect(result).toBeUndefined()
        expect(await provider.exists('m/a.txt')).toBe(false)
        expect(await provider.exists('m/b.txt')).toBe(false)
      })
    })

    describe('list', () => {
      beforeEach(async () => {
        await provider.upload({ key: 'list/a.txt', body: Buffer.from('a') })
        await provider.upload({ key: 'list/b.txt', body: Buffer.from('bb') })
        await provider.upload({ key: 'other/c.txt', body: Buffer.from('ccc') })
      })

      it('filters by prefix', async () => {
        const { files } = await provider.list({ prefix: 'list/' })
        expect(files.map((f) => f.key).sort()).toEqual(['list/a.txt', 'list/b.txt'])
      })

      it('returns file size in the listing', async () => {
        const { files } = await provider.list({ prefix: 'list/a.txt' })
        expect(files[0]?.size).toBe(1)
      })

      it('paginates with maxKeys + continuationToken', async () => {
        const first = await provider.list({ prefix: 'list/', maxKeys: 1 })
        expect(first.files).toHaveLength(1)
        expect(first.isTruncated).toBe(true)
        expect(first.nextToken).toBeDefined()

        const second = await provider.list({
          prefix: 'list/',
          maxKeys: 1,
          continuationToken: first.nextToken,
        })
        expect(second.files).toHaveLength(1)
        expect(second.isTruncated).toBe(false)
        expect(second.files[0]?.key).not.toBe(first.files[0]?.key)
      })
    })

    describe('copy / move', () => {
      it('copies an object, leaving the source intact', async () => {
        await provider.upload({ key: 'cp/src.txt', body: Buffer.from('data') })
        await provider.copy({ source: 'cp/src.txt', destination: 'cp/dst.txt' })
        expect(await provider.exists('cp/src.txt')).toBe(true)
        expect((await provider.download('cp/dst.txt')).toString()).toBe('data')
      })

      it('moves an object, removing the source', async () => {
        await provider.upload({ key: 'mv/src.txt', body: Buffer.from('data') })
        await provider.move({ source: 'mv/src.txt', destination: 'mv/dst.txt' })
        expect(await provider.exists('mv/src.txt')).toBe(false)
        expect((await provider.download('mv/dst.txt')).toString()).toBe('data')
      })

      it('rejects copying a missing source', async () => {
        await expect(
          provider.copy({ source: 'cp/none.txt', destination: 'cp/x.txt' })
        ).rejects.toThrow()
      })

      it('is a no-op when moving a key onto itself', async () => {
        await provider.upload({ key: 'mv/same.txt', body: Buffer.from('keep') })
        await provider.move({ source: 'mv/same.txt', destination: 'mv/same.txt' })
        expect(await provider.exists('mv/same.txt')).toBe(true)
        expect((await provider.download('mv/same.txt')).toString()).toBe('keep')
      })
    })

    describe('object-key validation', () => {
      it('rejects a traversal key on upload', async () => {
        await expect(
          provider.upload({ key: '../evil.txt', body: Buffer.from('x') })
        ).rejects.toThrow(InvalidObjectKeyError)
      })

      it('rejects a traversal key on download', async () => {
        await expect(provider.download('../evil.txt')).rejects.toThrow(InvalidObjectKeyError)
      })
    })

    describe('capabilities', () => {
      it(`reports signedUrls=${String(options.signedUrls)}`, () => {
        expect(provider.capabilities.signedUrls).toBe(options.signedUrls)
      })

      it(`reports publicUrls=${String(options.publicUrls)}`, () => {
        expect(provider.capabilities.publicUrls).toBe(options.publicUrls)
      })

      if (!options.signedUrls) {
        it('fails clearly on getSignedDownloadUrl when unsupported', async () => {
          await expect(provider.getSignedDownloadUrl({ key: 'docs/a.txt' })).rejects.toThrow()
        })

        it('fails clearly on getSignedUploadUrl when unsupported', async () => {
          await expect(provider.getSignedUploadUrl({ key: 'docs/a.txt' })).rejects.toThrow()
        })
      }

      if (!options.publicUrls) {
        it('throws clearly on getPublicUrl when unsupported', () => {
          expect(() => provider.getPublicUrl('docs/a.txt')).toThrow()
        })
      }
    })
  })
}
