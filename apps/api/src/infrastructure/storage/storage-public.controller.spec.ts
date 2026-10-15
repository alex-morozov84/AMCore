import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { StreamableFile } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { LocalStorageProvider } from './providers/local-storage.provider'
import { MemoryStorageProvider } from './providers/memory-storage.provider'
import type { StorageService } from './storage.service'
import { StoragePublicController } from './storage-public.controller'

import type { EnvService } from '@/env/env.service'

async function bytesOf(file: StreamableFile): Promise<string> {
  let text = ''
  for await (const chunk of file.getStream()) text += chunk.toString()
  return text
}

function controllerFor(
  values: Record<string, unknown>,
  storage: unknown
): { controller: StoragePublicController; headers: Record<string, string>; res: object } {
  const headers: Record<string, string> = {}
  const res = {}
  const adapterHost = {
    httpAdapter: {
      setHeader: (_res: unknown, name: string, value: string) => (headers[name] = value),
    },
  } as unknown as HttpAdapterHost
  const controller = new StoragePublicController(
    { get: (key: string) => values[key] } as EnvService,
    storage as StorageService,
    adapterHost
  )
  return { controller, headers, res }
}

describe('local public-only download', () => {
  let root: string
  let provider: LocalStorageProvider
  let controller: StoragePublicController
  let headers: Record<string, string>
  let res: object
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amcore-public-storage-'))
    provider = new LocalStorageProvider({ root })
    ;({ controller, headers, res } = controllerFor(
      { STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: root },
      provider
    ))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('serves public copies across provider restarts, follows a rewrite and stops after a delete', async () => {
    await provider.upload({
      key: 'public/avatar.webp',
      body: Buffer.from('public'),
      contentType: 'image/webp',
    })
    const response = await controller.download('public/avatar.webp', res)
    expect(await bytesOf(response)).toBe('public')
    expect(response.getHeaders().type).toBe('image/webp')
    provider = new LocalStorageProvider({ root })
    expect((await provider.download('public/avatar.webp')).toString()).toBe('public')
    await provider.upload({ key: 'public/avatar.webp', body: Buffer.from('second') })
    expect(await bytesOf(await controller.download('public/avatar.webp', res))).toBe('second')
    await provider.delete('public/avatar.webp')
    await expect(controller.download('public/avatar.webp', res)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('never serves a private key even when a public copy path is guessed for it', async () => {
    await provider.upload({ key: 'avatars/u1/original', body: Buffer.from('secret') })
    await expect(controller.download('avatars/u1/original', res)).rejects.toMatchObject({
      status: 404,
    })
    await expect(controller.download('public/avatars/u1/original', res)).rejects.toMatchObject({
      status: 404,
    })
  })

  it.each(['private.txt', '../meta/private.txt.json', '.amcore-probes/a.bin', 'missing'])(
    'never serves %s',
    async (key) => {
      await provider.upload({ key: 'private.txt', body: Buffer.from('secret') })
      await expect(controller.download(key, res)).rejects.toMatchObject({ status: 404 })
    }
  )

  it('neutralizes active HTML even when explicitly public', async () => {
    await provider.upload({
      key: 'public/x.html',
      body: Buffer.from('<script>alert(1)</script>'),
      contentType: 'text/html',
    })
    const response = await controller.download('public/x.html', res)
    expect(response.getHeaders().type).toBe('application/octet-stream')
    response.getStream().destroy()
  })

  it('does not describe a filesystem/provider fault as a missing public object', async () => {
    jest.spyOn(provider, 'getMetadata').mockRejectedValue(new Error('secret endpoint fault'))
    await expect(controller.download('public/x', res)).rejects.toMatchObject({ status: 500 })
  })

  it('serves the stored cache policy, and no-store when none was stored', async () => {
    await provider.upload({
      key: 'public/versioned.webp',
      body: Buffer.from('v'),
      cacheControl: 'public, max-age=31536000, immutable',
    })
    await provider.upload({ key: 'public/plain.webp', body: Buffer.from('p') })
    ;(await controller.download('public/versioned.webp', res)).getStream().destroy()
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
    ;(await controller.download('public/plain.webp', res)).getStream().destroy()
    expect(headers['Cache-Control']).toBe('no-store')
  })
})

describe('public download through the application credentials (s3 driver, api mode)', () => {
  const api = { STORAGE_DRIVER: 's3', STORAGE_PUBLIC_DELIVERY: 'api' }
  let storage: MemoryStorageProvider

  beforeEach(() => {
    storage = new MemoryStorageProvider()
  })

  it('serves a public key with safe headers', async () => {
    await storage.upload({
      key: 'public/avatars/u1/v-1-a/avatar-256.webp',
      body: Buffer.from('image-bytes'),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    })
    const { controller, headers, res } = controllerFor(api, storage)
    const response = await controller.download('public/avatars/u1/v-1-a/avatar-256.webp', res)
    expect(await bytesOf(response)).toBe('image-bytes')
    expect(response.getHeaders()).toMatchObject({ type: 'image/webp', disposition: 'attachment' })
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(headers.ETag).toMatch(/^"[0-9a-f]+"$/)
  })

  it('never reads a private key, however it is written', async () => {
    await storage.upload({ key: 'avatars/u1/v-1-a/original', body: Buffer.from('secret') })
    const spy = jest.spyOn(storage, 'downloadStream')
    const { controller, res } = controllerFor(api, storage)
    for (const key of [
      'avatars/u1/v-1-a/original',
      '__amcore_probes__/private-canary',
      'public/../avatars/u1/v-1-a/original',
      '/public/x',
      '',
    ]) {
      await expect(controller.download(key, res)).rejects.toMatchObject({ status: 404 })
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers 404 for a missing public key and 500 for a storage fault', async () => {
    const { controller, res } = controllerFor(api, storage)
    await expect(controller.download('public/missing.webp', res)).rejects.toMatchObject({
      status: 404,
    })
    jest.spyOn(storage, 'getMetadata').mockRejectedValue(new Error('bucket.internal denied'))
    await expect(controller.download('public/any.webp', res)).rejects.toMatchObject({
      status: 500,
      message: 'Storage download failed',
    })
  })

  it.each([
    [{ STORAGE_DRIVER: 's3', STORAGE_PUBLIC_DELIVERY: 'external' }],
    [{ STORAGE_DRIVER: 's3', STORAGE_PUBLIC_DELIVERY: 'acl' }],
    [{ STORAGE_DRIVER: 'memory', STORAGE_PUBLIC_DELIVERY: 'api' }],
  ])('is not a file route in this configuration (%j)', async (values) => {
    await storage.upload({ key: 'public/a.webp', body: Buffer.from('a') })
    const { controller, res } = controllerFor(values, storage)
    await expect(controller.download('public/a.webp', res)).rejects.toMatchObject({ status: 404 })
  })

  it('neutralizes active content and ignores an unsafe cache policy', async () => {
    await storage.upload({
      key: 'public/x.html',
      body: Buffer.from('<script>'),
      contentType: 'text/html',
      cacheControl: 'public\r\nSet-Cookie: x=1',
    })
    const { controller, headers, res } = controllerFor(api, storage)
    const response = await controller.download('public/x.html', res)
    expect(response.getHeaders().type).toBe('application/octet-stream')
    expect(headers['Cache-Control']).toBe('no-store')
    response.getStream().destroy()
  })
})
