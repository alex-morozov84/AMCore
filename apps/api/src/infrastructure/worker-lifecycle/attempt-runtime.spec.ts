import { AttemptRuntime } from './attempt-runtime'

describe('AttemptRuntime', () => {
  it.each(['resolve', 'reject'] as const)(
    'tracks a later pending call after the previous call settled by %s',
    async (outcome) => {
      const controller = new AbortController()
      const runtime = new AttemptRuntime({
        signal: controller.signal,
        abort: () => controller.abort(),
        dispose: () => undefined,
      })
      runtime.onTransportStarted(
        outcome === 'resolve' ? Promise.resolve() : Promise.reject(new Error('first call failed'))
      )
      await runtime.whenSettled()
      expect(runtime.transportPending).toBe(false)

      let settle!: () => void
      const next = new Promise<void>((resolve) => {
        settle = resolve
      })
      runtime.onTransportStarted(next)
      try {
        expect(runtime.transportPending).toBe(true)
      } finally {
        settle()
        await runtime.whenSettled()
      }
      expect(runtime.transportPending).toBe(false)
    }
  )
})
