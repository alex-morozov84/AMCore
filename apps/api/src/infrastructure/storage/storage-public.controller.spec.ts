import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { LocalStorageProvider } from './providers/local-storage.provider'
import type { StorageService } from './storage.service'
import { StoragePublicController } from './storage-public.controller'

import type { EnvService } from '@/env/env.service'

describe('local public-only download', () => {
  let root: string
  let provider: LocalStorageProvider
  let controller: StoragePublicController
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'amcore-public-storage-'))
    provider = new LocalStorageProvider({ root })
    const values = { STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: root }
    controller = new StoragePublicController(
      { get: (key: keyof typeof values) => values[key] } as EnvService,
      provider as unknown as StorageService
    )
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
    const response = await controller.download('public/avatar.webp')
    let bytes = ''
    for await (const chunk of response.getStream()) bytes += chunk.toString()
    expect(bytes).toBe('public')
    expect(response.getHeaders().type).toBe('image/webp')
    provider = new LocalStorageProvider({ root })
    expect((await provider.download('public/avatar.webp')).toString()).toBe('public')
    await provider.upload({ key: 'public/avatar.webp', body: Buffer.from('second') })
    const rewritten = await controller.download('public/avatar.webp')
    let rewrittenBytes = ''
    for await (const chunk of rewritten.getStream()) rewrittenBytes += chunk.toString()
    expect(rewrittenBytes).toBe('second')
    await provider.delete('public/avatar.webp')
    await expect(controller.download('public/avatar.webp')).rejects.toMatchObject({ status: 404 })
  })

  it('never serves a private key even when a public copy path is guessed for it', async () => {
    await provider.upload({ key: 'avatars/u1/original', body: Buffer.from('secret') })
    await expect(controller.download('avatars/u1/original')).rejects.toMatchObject({ status: 404 })
    await expect(controller.download('public/avatars/u1/original')).rejects.toMatchObject({
      status: 404,
    })
  })

  it.each(['private.txt', '../meta/private.txt.json', '.amcore-probes/a.bin', 'missing'])(
    'never serves %s',
    async (key) => {
      await provider.upload({ key: 'private.txt', body: Buffer.from('secret') })
      await expect(controller.download(key)).rejects.toMatchObject({ status: 404 })
    }
  )

  it('neutralizes active HTML even when explicitly public', async () => {
    await provider.upload({
      key: 'public/x.html',
      body: Buffer.from('<script>alert(1)</script>'),
      contentType: 'text/html',
    })
    const response = await controller.download('public/x.html')
    expect(response.getHeaders().type).toBe('application/octet-stream')
    response.getStream().destroy()
  })

  it('does not describe a filesystem/provider fault as a missing public object', async () => {
    jest.spyOn(provider, 'getMetadata').mockRejectedValue(new Error('secret endpoint fault'))
    await expect(controller.download('x')).rejects.toMatchObject({ status: 500 })
  })
})
