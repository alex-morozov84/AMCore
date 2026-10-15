import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/* oxlint-disable no-console -- an operator CLI reports to stdout (mirrors telegram-setup.ts) */
/**
 * Operator check of the configured file storage against the REAL provider:
 *
 *   pnpm --filter api storage:check            # local (tsx)
 *   node dist/cli/storage-check.js             # production image
 *
 * Reads the same environment as the API (no database, no Redis), then exercises private
 * upload/download/delete, presigned download and upload, multipart, copy, list, anonymous
 * delivery of the public namespace and the refusal of the private one. It writes only under
 * the reserved diagnostic folder, removes what it created and never prints credentials,
 * endpoints or provider messages. Exit code 0 means every step passed or was skipped.
 */
import { validate } from '../env.js'
import { readAnonymously } from '../infrastructure/storage/storage-anonymous-read.js'
import {
  formatStorageCheck,
  runStorageCheck,
  storageCheckPassed,
} from '../infrastructure/storage/storage-check.runner.js'
import { createStorageProvider } from '../infrastructure/storage/storage-provider.factory.js'

async function main(): Promise<boolean> {
  let env: ReturnType<typeof validate>
  try {
    env = validate(process.env)
  } catch (error) {
    const issues = (error as { issues?: { path: PropertyKey[] }[] }).issues ?? []
    // Names only: an invalid value may be a secret.
    console.error(
      `storage:check failed — invalid configuration: ${issues.map((i) => i.path.join('.')).join(', ')}`
    )
    return false
  }
  if (env.STORAGE_DRIVER === 'memory') {
    console.error('storage:check needs the local or s3 driver; the memory driver keeps nothing.')
    return false
  }
  const singleBucket =
    !env.STORAGE_PUBLIC_BUCKET || env.STORAGE_PUBLIC_BUCKET === env.STORAGE_BUCKET
  console.log(
    `storage:check driver=${env.STORAGE_DRIVER} mode=${env.STORAGE_PUBLIC_DELIVERY} buckets=${singleBucket ? 'one' : 'two'}`
  )
  const steps = await runStorageCheck({
    provider: createStorageProvider({ get: (key) => env[key] }),
    read: readAnonymously,
    send: async (url, init) =>
      (
        await fetch(url, {
          method: init.method,
          body: init.body ? new Uint8Array(init.body) : undefined,
        })
      ).status,
    fetchBody: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL ?? '',
    urlForm:
      env.STORAGE_DRIVER === 'local' || env.STORAGE_PUBLIC_DELIVERY === 'api'
        ? 'route'
        : 'bucket-root',
    singleBucket,
    probePrefix: env.STORAGE_PROBE_PREFIX,
  })
  console.log(formatStorageCheck(steps))
  return storageCheckPassed(steps)
}

// Run only when invoked directly (not when imported by a test).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  void main().then((ok) => process.exit(ok ? 0 : 1))
}
