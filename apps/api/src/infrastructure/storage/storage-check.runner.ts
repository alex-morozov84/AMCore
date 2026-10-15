import { randomUUID } from 'node:crypto'

import {
  checkPublicDelivery,
  ensureCanaries,
  type PublicDeliveryDeps,
} from './public-delivery-check'
import type { StorageProvider } from './storage.interface'
import type { AnonymousRead } from './storage-anonymous-read'

export interface CheckStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  /** A short class or code. Never a provider message, an endpoint or a credential. */
  detail?: string
}

export interface StorageCheckDeps {
  provider: StorageProvider
  /** One unauthenticated GET, as an anonymous browser would make it. */
  read: AnonymousRead
  /** Perform an HTTP request with the given method and body (presigned URLs). */
  send: (url: string, init: { method: 'GET' | 'PUT'; body?: Buffer }) => Promise<number>
  /** Download the body of a GET (presigned download). */
  fetchBody: (url: string) => Promise<Buffer>
  publicBaseUrl: string
  singleBucket: boolean
  probePrefix: string
  timeoutMs?: number
}

const MULTIPART_BYTES = 6 * 1024 * 1024
const PAYLOAD = Buffer.from('amcore-storage-check')

function describeFailure(error: unknown): string {
  const e = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } }
  const status = e?.$metadata?.httpStatusCode
  return [e?.name ?? 'Error', e?.code, status ? `HTTP ${status}` : undefined]
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

/**
 * Exercise the configured storage the way the application and a browser use it, and report
 * pass/fail per step. Used by the operator command (`storage:check`) against a real provider
 * and by the wire tests against emulators. It writes only under the reserved diagnostic
 * folder, removes what it created, and never reports provider text or secrets.
 */
export async function runStorageCheck(deps: StorageCheckDeps): Promise<CheckStep[]> {
  const { provider } = deps
  const steps: CheckStep[] = []
  const created: string[] = []
  const run = randomUUID().slice(0, 8)
  const folder = `${deps.probePrefix}/check-${run}`
  const key = (name: string): string => {
    const full = `${folder}/${name}`
    created.push(full)
    return full
  }

  const step = async (name: string, action: () => Promise<string | void>): Promise<boolean> => {
    try {
      const detail = await action()
      steps.push({ name, status: 'ok', ...(detail ? { detail } : {}) })
      return true
    } catch (error) {
      steps.push({ name, status: 'failed', detail: describeFailure(error) })
      return false
    }
  }
  const skip = (name: string, detail: string): void => {
    steps.push({ name, status: 'skipped', detail })
  }
  const must = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message)
  }

  await step('private upload, download, metadata and delete', async () => {
    const k = key('private.bin')
    await provider.upload({ key: k, body: PAYLOAD, contentType: 'application/octet-stream' })
    must((await provider.download(k)).equals(PAYLOAD), 'bytes differ')
    must((await provider.getMetadata(k)).visibility === 'private', 'not private')
    must(await provider.exists(k), 'missing after upload')
    await provider.delete(k)
    must(!(await provider.exists(k)), 'still present after delete')
  })

  if (provider.capabilities.signedUrls) {
    await step('presigned download', async () => {
      const k = key('presign-get.bin')
      await provider.upload({ key: k, body: PAYLOAD })
      const body = await deps.fetchBody(await provider.getSignedDownloadUrl({ key: k }))
      must(body.equals(PAYLOAD), 'bytes differ')
    })
    await step('presigned upload', async () => {
      const k = key('presign-put.bin')
      const code = await deps.send(await provider.getSignedUploadUrl({ key: k }), {
        method: 'PUT',
        body: PAYLOAD,
      })
      must(code >= 200 && code < 300, `HTTP ${code}`)
      must((await provider.download(k)).equals(PAYLOAD), 'bytes differ')
    })
  } else {
    skip('presigned download and upload', 'driver has no signed URLs')
  }

  await step('multipart upload', async () => {
    const k = key('multipart.bin')
    const big = Buffer.alloc(MULTIPART_BYTES, 7)
    await provider.upload({ key: k, body: big })
    must((await provider.getMetadata(k)).contentLength === big.length, 'size differs')
  })

  await step('copy and list', async () => {
    const source = key('copy-source.bin')
    const target = key('copy-target.bin')
    await provider.upload({ key: source, body: PAYLOAD })
    await provider.copy({ source, destination: target })
    must((await provider.download(target)).equals(PAYLOAD), 'copy differs')
    const listed = (await provider.list({ prefix: `${folder}/` })).files.map((f) => f.key)
    must(listed.includes(source) && listed.includes(target), 'listing misses keys')
  })

  if (provider.capabilities.publicUrls && deps.publicBaseUrl) {
    const delivery: PublicDeliveryDeps = {
      storage: provider,
      read: deps.read,
      publicBaseUrl: deps.publicBaseUrl,
      singleBucket: deps.singleBucket,
      probePrefix: deps.probePrefix,
    }
    await step('public delivery and private exposure', async () => {
      await ensureCanaries(delivery)
      const result = await checkPublicDelivery(
        delivery,
        AbortSignal.timeout(deps.timeoutMs ?? 15_000)
      )
      if (!result.ok) {
        throw Object.assign(new Error(result.failure), {
          name: `${result.stage}: ${result.failure}${result.status ? ` (HTTP ${result.status})` : ''}`,
        })
      }
    })
  } else {
    skip('public delivery and private exposure', 'driver has no public URLs')
  }

  await step('delete many and cleanup', async () => {
    await provider.deleteMany(created)
    for (const k of created) must(!(await provider.exists(k)), 'still present')
  })

  return steps
}

export function formatStorageCheck(steps: CheckStep[]): string {
  return steps
    .map(
      (s) =>
        `${s.status === 'ok' ? 'PASS' : s.status === 'skipped' ? 'SKIP' : 'FAIL'}  ${s.name}${s.detail ? ` — ${s.detail}` : ''}`
    )
    .join('\n')
}

export function storageCheckPassed(steps: CheckStep[]): boolean {
  return steps.every((s) => s.status !== 'failed')
}
