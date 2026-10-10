import type { Queue } from 'bullmq'
import { z } from 'zod'

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)

/** Bull system keys occupy the same namespace as job IDs. Never interpret one as a job. */
export function managedJobKey(queue: Queue, id: string): string {
  identifier.parse(id)
  const key = queue.toKey(id)
  if (Object.values(queue.keys).includes(key)) throw new Error('CONTENT_UNSUPPORTED')
  return key
}
