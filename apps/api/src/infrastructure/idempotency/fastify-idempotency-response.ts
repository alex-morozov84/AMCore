import type { FastifyInstance, FastifyReply } from 'fastify'

const pending = new WeakMap<FastifyReply, (body: unknown) => Promise<void>>()

/** Capture the serialized response before Fastify writes bytes, once per reservation. */
export function configureFastifyIdempotency(instance: FastifyInstance): void {
  instance.addHook('onSend', async (_request, reply, payload) => {
    const complete = pending.get(reply)
    if (complete) {
      pending.delete(reply)
      await complete(payload)
    }
    return payload
  })
}

export function captureFastifyResponse(
  reply: FastifyReply,
  complete: (body: unknown) => Promise<void>
): void {
  pending.set(reply, complete)
}
