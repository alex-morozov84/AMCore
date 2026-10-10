import type { Redis } from 'ioredis'

import { JOB_READ_FIELDS, JOB_READ_LUA } from './scripts/job-read.lua'

export type RawJobObservation =
  | { readonly status: 'unavailable'; readonly reason: string }
  | {
      readonly status: 'observed'
      readonly bytes: number
      readonly fields: Readonly<Record<string, string | null>>
    }

/** Internal raw observations are never response DTOs or log arguments. */
export async function readBoundedJob(client: Redis, key: string): Promise<RawJobObservation> {
  const result = await client.eval(JOB_READ_LUA, 1, key)
  return decodeBoundedJob(result)
}

export function decodeBoundedJob(result: unknown): RawJobObservation {
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'unavailable' && typeof result[1] === 'string')
    return { status: 'unavailable', reason: result[1] }
  if (
    result[0] !== 'observed' ||
    !Array.isArray(result[1]) ||
    result[1].length !== JOB_READ_FIELDS.length ||
    !Number.isSafeInteger(result[2]) ||
    result[2] < 0 ||
    result[2] > 65536
  )
    throw new Error('INVALID_BROKER_REPLY')
  const values = result[1] as unknown[]
  if (values.some((value) => value !== null && typeof value !== 'string'))
    throw new Error('INVALID_BROKER_REPLY')
  const fields = values as (string | null)[]
  return {
    status: 'observed',
    bytes: result[2] as number,
    fields: Object.fromEntries(JOB_READ_FIELDS.map((field, i) => [field, fields[i] ?? null])),
  }
}

/** Reserve worst-case bytes before each read; four parallel readers share one request budget. */
export async function readBoundedJobPage(
  client: Redis,
  keys: readonly string[]
): Promise<{ readonly jobs: readonly RawJobObservation[]; readonly truncated: boolean }> {
  const jobs: RawJobObservation[] = []
  let remaining = 512 * 1024
  let offset = 0
  while (offset < Math.min(keys.length, 50)) {
    const count = Math.min(4, Math.floor(remaining / 65536), keys.length - offset, 50 - offset)
    if (count === 0) break
    remaining -= count * 65536
    const observations = await Promise.all(
      keys.slice(offset, offset + count).map((key) => readBoundedJob(client, key))
    )
    for (const observation of observations) {
      remaining += 65536 - (observation.status === 'observed' ? observation.bytes : 0)
      jobs.push(observation)
    }
    offset += count
  }
  return { jobs, truncated: offset < keys.length }
}
