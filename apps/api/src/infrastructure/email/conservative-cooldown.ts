import { performance } from 'node:perf_hooks'

import { WorkPolicyError } from '../background-work/work-policy-error.js'

const MAX_DELAY = 86_400_000
interface Sample {
  wall: number
  monotonic: number
}
interface Anchor {
  revision: number
  started: number
  sample: Sample
}

/** Lost timing history discards credit; persisted wall time never grants admission. */
export class ConservativeCooldown {
  private readonly anchors = new Map<string, Anchor>()
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly sample: () => Sample = () => ({
      wall: Date.now(),
      monotonic: performance.now(),
    }),
    private readonly capacity = 10000
  ) {}

  remaining(key: string, revision: number, delay: number): number {
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > MAX_DELAY)
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
    if (delay === 0) return 0
    const now = this.sample()
    if (![now.wall, now.monotonic].every(Number.isFinite))
      throw new WorkPolicyError('CLOCK_UNCERTAIN')
    let anchor = this.anchors.get(key)
    if (!anchor || anchor.revision !== revision || !this.continuous(anchor.sample, now)) {
      if (!anchor && this.anchors.size >= this.capacity) throw new WorkPolicyError('STORAGE_LIMIT')
      anchor = { revision, started: now.monotonic, sample: now }
      this.anchors.set(key, anchor)
    }
    anchor.sample = now
    this.schedule()
    return Math.max(0, Math.ceil(delay - (now.monotonic - anchor.started)))
  }

  forget(key: string): void {
    this.anchors.delete(key)
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.anchors.clear()
  }

  /** Timer observes only process clock continuity; it performs no business work. */
  private schedule(): void {
    if (this.timer || this.anchors.size === 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const now = this.sample()
      for (const [key, anchor] of this.anchors) {
        if (!this.continuous(anchor.sample, now)) this.anchors.delete(key)
        else anchor.sample = now
      }
      this.schedule()
    }, 500)
    this.timer.unref()
  }

  private continuous(before: Sample, now: Sample): boolean {
    const monotonic = now.monotonic - before.monotonic
    const wall = now.wall - before.wall
    return monotonic >= 0 && monotonic <= 1000 && wall >= 0 && Math.abs(monotonic - wall) <= 200
  }
}
