import type { ObservedTransactionResult } from '@/prisma/observed-transaction'

interface Waiter<T> {
  cacheToken: string | null
  resolve: (value: T) => void
  reject: (error: unknown) => void
  dispose: () => void
}
interface Flight<T> {
  cacheToken: string | null
  generation: number
  logicalSettled: boolean
  fillReserved: boolean
  physicalCompletion: Promise<void>
  value?: T
}

/** Finite detachable waiters; timed-out Prisma startup still owns the physical flight. */
export class AiCatalogLoad<T> {
  private readonly waiters = new Set<Waiter<T>>()
  private flight: Flight<T> | undefined
  private reuse: { value: T; generation: number; until: number; flight: Flight<T> } | undefined
  private nextStart = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  generation = 0

  constructor(
    private readonly start: (canQuery: () => void) => ObservedTransactionResult<T>,
    private readonly now: () => number = () => performance.now()
  ) {}

  invalidate(): void {
    this.generation++
    this.reuse = undefined
  }

  close(): void {
    this.closed = true
    this.finish(undefined, new Error('catalogue_unavailable'))
  }

  reserveFill(): string | null {
    const flight = this.reuse?.flight
    if (
      !flight ||
      flight.fillReserved ||
      this.reuse?.generation !== this.generation ||
      this.closed ||
      !flight.cacheToken
    )
      return null
    flight.fillReserved = true
    return flight.cacheToken
  }

  load(signal?: AbortSignal, cacheToken: string | null = null): Promise<T> {
    signal?.throwIfAborted()
    if (this.closed) return Promise.reject(new Error('catalogue_unavailable'))
    if (this.reuse && this.reuse.generation === this.generation && this.now() < this.reuse.until)
      return Promise.resolve(this.reuse.value)
    if (this.waiters.size >= 64) return Promise.reject(new Error('catalogue_unavailable'))
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => this.remove(waiter, signal?.reason)
      const timeout = setTimeout(
        () => this.remove(waiter, new Error('catalogue_unavailable')),
        2000
      )
      const waiter: Waiter<T> = {
        cacheToken,
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
        },
      }
      this.waiters.add(waiter)
      signal?.addEventListener('abort', abort, { once: true })
      this.schedule()
    })
  }

  private remove(waiter: Waiter<T>, error: unknown): void {
    if (!this.waiters.delete(waiter)) return
    waiter.dispose()
    waiter.reject(error)
    if (!this.waiters.size && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private schedule(): void {
    if (this.closed || !this.waiters.size || this.flight || this.timer) return
    const delay = this.nextStart - this.now()
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.schedule()
      }, delay)
      return
    }
    this.launch()
  }

  private launch(): void {
    const generation = this.generation
    this.nextStart = this.now() + 1000
    let operation: ObservedTransactionResult<T>
    try {
      operation = this.start(() => {
        if (this.closed || !this.waiters.size || generation !== this.generation)
          throw new Error('catalogue_unavailable')
      })
    } catch (error) {
      this.finish(undefined, error)
      return
    }
    const flight: Flight<T> = {
      cacheToken: this.waiters.values().next().value?.cacheToken ?? null,
      generation,
      logicalSettled: false,
      fillReserved: false,
      physicalCompletion: operation.physicalCompletion,
    }
    this.flight = flight
    void operation.result.then(
      (value) => {
        flight.value = value
        flight.logicalSettled = true
      },
      (error: unknown) => {
        flight.logicalSettled = true
        this.nextStart = this.now() + 1000
        this.finish(undefined, error)
      }
    )
    void operation.physicalCompletion.then(() => this.settled(flight))
  }

  private settled(flight: Flight<T>): void {
    if (this.flight !== flight) return
    this.flight = undefined
    if (
      flight.value !== undefined &&
      !this.closed &&
      this.waiters.size &&
      flight.generation === this.generation
    ) {
      this.reuse = {
        value: flight.value,
        generation: flight.generation,
        until: this.now() + 1000,
        flight,
      }
      this.finish(flight.value)
    } else this.finish(undefined, new Error('catalogue_unavailable'))
    // Never launch a query or fill from settlement: a subsequent live caller owns it.
  }

  private finish(value: T | undefined, error?: unknown): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    for (const waiter of this.waiters) {
      waiter.dispose()
      if (error !== undefined) waiter.reject(error)
      else waiter.resolve(value!)
    }
    this.waiters.clear()
  }
}
