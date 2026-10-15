import type { StorageProvider } from './storage.interface'
import type { AnonymousRead } from './storage-anonymous-read'
import { PUBLIC_KEY_PREFIX } from './storage-namespace'

/** Fixed bytes. The two canaries differ, so one can never be mistaken for the other. */
export const PUBLIC_CANARY_BYTES = Buffer.from('amcore-public-canary-v1')
export const PRIVATE_CANARY_BYTES = Buffer.from('amcore-private-canary-v1')

export type PublicCheckStage =
  'setup' | 'public_read' | 'private_exposed_api' | 'private_exposed_base'
export type PublicCheckFailure =
  | 'public_not_served'
  | 'public_unreachable'
  | 'content_mismatch'
  | 'private_exposed'
  | 'check_error'
  | 'timeout'

export type PublicCheckResult =
  | { ok: true }
  | { ok: false; stage: PublicCheckStage; failure: PublicCheckFailure; status?: number }

export interface PublicDeliveryDeps {
  storage: Pick<StorageProvider, 'upload' | 'getPublicUrl' | 'getUnsignedObjectUrl'>
  read: AnonymousRead
  /** `STORAGE_PUBLIC_BASE_URL`: the root of the public bucket as a browser reaches it. */
  publicBaseUrl: string
  /** One bucket holds both namespaces, so the public base could also reach private keys. */
  singleBucket: boolean
  /** `STORAGE_PROBE_PREFIX`: the reserved folder for diagnostic objects. */
  probePrefix: string
}

/** Statuses that prove an anonymous client was refused (a missing object is not exposed either). */
const DENIED = new Set([401, 403, 404])

export function canaryKeys(probePrefix: string): { publicKey: string; privateKey: string } {
  return {
    publicKey: `${PUBLIC_KEY_PREFIX}${probePrefix}/public-canary`,
    privateKey: `${probePrefix}/private-canary`,
  }
}

/**
 * Write both canaries. The keys and bytes are fixed, so repeating this from several
 * instances or after a restart is idempotent; the periodic check only reads them.
 */
export async function ensureCanaries(deps: PublicDeliveryDeps): Promise<void> {
  const { publicKey, privateKey } = canaryKeys(deps.probePrefix)
  await deps.storage.upload({
    key: publicKey,
    body: PUBLIC_CANARY_BYTES,
    contentType: 'application/octet-stream',
  })
  await deps.storage.upload({
    key: privateKey,
    body: PRIVATE_CANARY_BYTES,
    contentType: 'application/octet-stream',
  })
}

function bucketRootUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
}

async function attempt(
  read: AnonymousRead,
  url: string,
  signal: AbortSignal
): Promise<{ status: number; body: Buffer } | { error: 'timeout' | 'unreachable' }> {
  try {
    return await read(url, signal)
  } catch {
    return { error: signal.aborted ? 'timeout' : 'unreachable' }
  }
}

/**
 * Read-only verification of the public boundary:
 * 1. the public canary is served anonymously with its own bytes;
 * 2. an unsigned request through the storage API is refused for the private canary;
 * 3. with one bucket, the public base must not serve the private canary either.
 * A refusal means 401, 403 or 404. A 2xx on a private canary is an exposure, and that
 * is reported apart from a server that simply failed to answer.
 */
export async function checkPublicDelivery(
  deps: PublicDeliveryDeps,
  signal: AbortSignal
): Promise<PublicCheckResult> {
  const { publicKey, privateKey } = canaryKeys(deps.probePrefix)

  const served = await attempt(deps.read, deps.storage.getPublicUrl(publicKey), signal)
  if ('error' in served) {
    return {
      ok: false,
      stage: 'public_read',
      failure: served.error === 'timeout' ? 'timeout' : 'public_unreachable',
    }
  }
  if (served.status >= 500) {
    return { ok: false, stage: 'public_read', failure: 'public_unreachable', status: served.status }
  }
  if (served.status !== 200) {
    return { ok: false, stage: 'public_read', failure: 'public_not_served', status: served.status }
  }
  if (!served.body.equals(PUBLIC_CANARY_BYTES)) {
    return { ok: false, stage: 'public_read', failure: 'content_mismatch', status: 200 }
  }

  if (deps.storage.getUnsignedObjectUrl) {
    const url = await deps.storage.getUnsignedObjectUrl(privateKey)
    const result = await refused(deps.read, url, signal, 'private_exposed_api')
    if (result) return result
  }
  if (deps.singleBucket) {
    const url = bucketRootUrl(deps.publicBaseUrl, privateKey)
    const result = await refused(deps.read, url, signal, 'private_exposed_base')
    if (result) return result
  }
  return { ok: true }
}

/** `undefined` when the private canary is refused; otherwise the failure to report. */
async function refused(
  read: AnonymousRead,
  url: string,
  signal: AbortSignal,
  stage: 'private_exposed_api' | 'private_exposed_base'
): Promise<PublicCheckResult | undefined> {
  const response = await attempt(read, url, signal)
  if ('error' in response) {
    return { ok: false, stage, failure: response.error === 'timeout' ? 'timeout' : 'check_error' }
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: false, stage, failure: 'private_exposed', status: response.status }
  }
  if (DENIED.has(response.status)) return undefined
  return { ok: false, stage, failure: 'check_error', status: response.status }
}
