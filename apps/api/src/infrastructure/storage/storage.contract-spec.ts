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
  /**
   * Public and private keys live in different stores (two S3 buckets), so a list prefix
   * that spans both namespaces (`''`) is ambiguous and refused. When false, an empty
   * prefix lists every key.
   */
  separateNamespaces?: boolean
}

export function runStorageProviderContract(
  name: string,
  /** A fresh, empty provider per test; a wire backend may create its buckets asynchronously. */
  createProvider: () => StorageProvider | Promise<StorageProvider>,
  options: StorageContractOptions
): void {
  describe(`StorageProvider contract: ${name}`, () => {
    let provider: StorageProvider

    beforeEach(async () => {
      provider = await createProvider()
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

    describe('visibility (the key namespace decides)', () => {
      it('is private for a key outside the public namespace', async () => {
        await provider.upload({ key: 'v/private.txt', body: Buffer.from('p') })
        expect((await provider.getMetadata('v/private.txt')).visibility).toBe('private')
      })

      it('is public for a key under public/, with or without the explicit value', async () => {
        await provider.upload({ key: 'public/v/a.txt', body: Buffer.from('p') })
        await provider.upload({
          key: 'public/v/b.txt',
          body: Buffer.from('p'),
          visibility: 'public-read',
        })
        expect((await provider.getMetadata('public/v/a.txt')).visibility).toBe('public-read')
        expect((await provider.getMetadata('public/v/b.txt')).visibility).toBe('public-read')
      })

      it('rejects a visibility that contradicts the key namespace', async () => {
        await expect(
          provider.upload({ key: 'v/x.txt', body: Buffer.from('p'), visibility: 'public-read' })
        ).rejects.toBeInstanceOf(InvalidObjectKeyError)
        await expect(
          provider.upload({ key: 'public/v/x.txt', body: Buffer.from('p'), visibility: 'private' })
        ).rejects.toBeInstanceOf(InvalidObjectKeyError)
      })

      it('copies and moves within a namespace but never across it', async () => {
        await provider.upload({ key: 'public/v/src.txt', body: Buffer.from('p') })
        await provider.copy({ source: 'public/v/src.txt', destination: 'public/v/copy.txt' })
        expect((await provider.getMetadata('public/v/copy.txt')).visibility).toBe('public-read')
        await expect(
          provider.copy({ source: 'public/v/src.txt', destination: 'v/private-copy.txt' })
        ).rejects.toBeInstanceOf(InvalidObjectKeyError)
        await expect(
          provider.move({ source: 'public/v/src.txt', destination: 'v/private-move.txt' })
        ).rejects.toBeInstanceOf(InvalidObjectKeyError)
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

      it('lists one namespace with a prefix inside it', async () => {
        await provider.upload({ key: 'public/list/p.txt', body: Buffer.from('p') })
        const publicOnly = await provider.list({ prefix: 'public/list/' })
        expect(publicOnly.files.map((f) => f.key)).toEqual(['public/list/p.txt'])
        const privateOnly = await provider.list({ prefix: 'list/' })
        expect(privateOnly.files.map((f) => f.key).sort()).toEqual(['list/a.txt', 'list/b.txt'])
      })

      if (options.separateNamespaces) {
        it('refuses an empty prefix because it spans both stores', async () => {
          await expect(provider.list({ prefix: '' })).rejects.toBeInstanceOf(InvalidObjectKeyError)
        })
      } else {
        it('lists every key, public and private, with an empty prefix', async () => {
          await provider.upload({ key: 'public/list/p.txt', body: Buffer.from('p') })
          const { files } = await provider.list({ prefix: '' })
          expect(files.map((f) => f.key).sort()).toEqual([
            'list/a.txt',
            'list/b.txt',
            'other/c.txt',
            'public/list/p.txt',
          ])
        })
      }

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

    describe('prefix directories are not objects', () => {
      it('does not treat a key prefix as an existing object', async () => {
        await provider.upload({ key: 'dir/child.txt', body: Buffer.from('c') })
        expect(await provider.exists('dir')).toBe(false)
        await expect(provider.getMetadata('dir')).rejects.toThrow()
      })

      it('delete on a prefix is a no-op and preserves children', async () => {
        await provider.upload({ key: 'dir2/child.txt', body: Buffer.from('c') })
        await provider.delete('dir2')
        expect(await provider.exists('dir2/child.txt')).toBe(true)
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
          expect(() => provider.getPublicUrl('public/docs/a.txt')).toThrow()
        })
      } else {
        it('refuses a public URL for a private key', () => {
          expect(() => provider.getPublicUrl('docs/a.txt')).toThrow(InvalidObjectKeyError)
        })
      }
    })
  })
}
