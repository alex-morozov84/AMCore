import { setTimeout as delay } from 'node:timers/promises'

// A registry answering 5xx or dropping the connection is transient; the same pull
// succeeds moments later. Interruption (exit 130/143) and every other failure
// (auth, missing image, no disk) must not be retried.
const TRANSIENT = /\b50[0234]\b|timeout|timed out|TLS handshake|connection reset|unexpected EOF/i

export function isTransientPullFailure(error) {
  const message = String(error?.message ?? '')
  return !/failed \((?:130|143|SIG[A-Z]+)\)/.test(message) && TRANSIENT.test(message)
}

/** Pull registry images before `up`, so a registry hiccup does not fail a whole lane. */
export async function pullWithRetry(pull, { attempts = 4, wait = delay } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pull()
    } catch (error) {
      if (attempt >= attempts || !isTransientPullFailure(error)) throw error
      process.stderr.write(`Image pull failed (attempt ${attempt}/${attempts}); retrying.\n`)
      await wait(attempt * 5000)
    }
  }
}

export async function pullMigratorBase(dockerfile, docker, retryOptions) {
  const image = /^FROM (ghcr\.io\/pnpm\/pnpm:[^\s@]+@sha256:[a-f0-9]{64}) AS migrator-pnpm$/m.exec(
    dockerfile
  )?.[1]
  if (!image) throw new Error('Expected a digest-pinned pnpm image in the migrator Dockerfile')
  try {
    await docker(['image', 'inspect', image])
  } catch (error) {
    if (!/No such image/i.test(error.message)) throw error
    await pullWithRetry(() => docker(['pull', '--quiet', image]), retryOptions)
  }
}
