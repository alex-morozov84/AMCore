/**
 * Minimal fetch-based SSE reader for the Arc C realtime e2e gates (notifications + AI runs). A real
 * socket is required — supertest's in-memory agent does not deliver incremental `text/event-stream`
 * chunks. Parses `data:` frames into events and skips `:` heartbeat/ready comment frames; `next()`
 * is bounded so a missing event fails fast instead of hanging the suite. Generic over the event
 * shape — defaults to a loose record, so each consumer can pin its own event type (e.g.
 * `SseClient.open<AiRunSseEvent>(...)`).
 */
export class SseClient<T = Record<string, unknown>> {
  private readonly events: T[] = []
  private readonly waiters: Array<{
    resolve: (e: T) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  private buffer = ''
  private closed = false

  private constructor(
    private readonly controller: AbortController,
    readonly response: Response
  ) {}

  static async open<T = Record<string, unknown>>(
    url: string,
    headers: Record<string, string>
  ): Promise<SseClient<T>> {
    const controller = new AbortController()
    const response = await fetch(url, { headers, signal: controller.signal })
    const client = new SseClient<T>(controller, response)
    if (response.body) void client.pump(response.body.getReader())
    return client
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        this.buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
          const frame = this.buffer.slice(0, idx)
          this.buffer = this.buffer.slice(idx + 2)
          this.handleFrame(frame)
        }
      }
    } catch {
      /* aborted on close() — expected */
    }
  }

  private handleFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('')
    if (data.length === 0) return // a `:` heartbeat/ready comment frame
    const event = JSON.parse(data) as T
    const waiter = this.waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.resolve(event)
    } else {
      this.events.push(event)
    }
  }

  /** Resolve the next data event, or reject after `timeoutMs` (no silent waiting). */
  next(timeoutMs = 5000): Promise<T> {
    const buffered = this.events.shift()
    if (buffered) return Promise.resolve(buffered)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer)
        if (i !== -1) this.waiters.splice(i, 1)
        reject(new Error('SSE next() timed out'))
      }, timeoutMs)
      this.waiters.push({ resolve, reject, timer })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('SSE client closed'))
    }
    this.waiters.length = 0
  }
}
