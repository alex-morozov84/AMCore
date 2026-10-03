import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Guard: every BullMQ queue must come from the single queue inventory.
 *
 * A queue created outside `queue-inventory.constant.ts` is invisible to the Console Background
 * work screen, the depth metrics and `QueueService`, and nothing would say so. The compiler
 * already rejects a `QueueName` without a descriptor; this guard closes the other gap: code that
 * registers or opens a queue directly. Checked per occurrence, in production sources only.
 *
 * To add a queue, follow "Adding a queue" in the queue README, not a new allowlist entry.
 */
const SRC_ROOT = join(__dirname, '..', '..')
const NEEDLES = [
  'registerQueue(',
  'registerQueueAsync(',
  '@InjectQueue(',
  'new Queue(',
  'new Queue<',
]

/** Places allowed to create queues, each with the reason. Keep this list short. */
const ALLOWLIST: Record<string, string> = {
  'infrastructure/queue/queue.module.ts':
    'registers the enabled inventory, the only place that may',
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'generated' ? [] : sources(path)
    return /\.ts$/.test(entry) && !/\.(spec|test|e2e-spec)\.ts$/.test(entry) ? [path] : []
  })
}

function violations(): string[] {
  return sources(SRC_ROOT).flatMap((file) => {
    const name = relative(SRC_ROOT, file)
    if (name in ALLOWLIST) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        const code = line.trimStart()
        if (code.startsWith('//') || code.startsWith('*')) return []
        return NEEDLES.some((needle) => line.includes(needle)) ? [`${name}:${index + 1}`] : []
      })
  })
}

describe('queue registration coverage', () => {
  it('creates queues only through the single inventory', () => {
    expect(violations()).toEqual([])
  })

  it('keeps every allowlisted file real and justified', () => {
    const all = sources(SRC_ROOT).map((file) => relative(SRC_ROOT, file))
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(10)
      expect(all).toContain(file)
    }
  })
})
