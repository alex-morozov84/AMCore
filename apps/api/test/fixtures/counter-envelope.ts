import type { createClient } from '@redis/client'

type EnvelopeClient = Pick<ReturnType<typeof createClient>, 'set' | 'get'>

/**
 * Seeds and reads the `{"value":N,"expires":ms}` counter envelope that the login and
 * auth-mail scripts accept under a bare key with a matching `PX` expiry. The shape is
 * written by hand from the contract documented in those scripts; it no longer claims to
 * match bytes written by any removed library.
 */
export async function seedEnvelope(
  client: EnvelopeClient,
  key: string,
  value: number,
  ttlMs: number
): Promise<void> {
  await client.set(key, JSON.stringify({ value, expires: Date.now() + ttlMs }), {
    expiration: { type: 'PX', value: ttlMs },
  })
}

/** The envelope's `value`, or `undefined` when the key is absent. */
export async function readEnvelope(
  client: EnvelopeClient,
  key: string
): Promise<number | undefined> {
  const raw = await client.get(key)
  return raw === null ? undefined : (JSON.parse(raw as string) as { value: number }).value
}
