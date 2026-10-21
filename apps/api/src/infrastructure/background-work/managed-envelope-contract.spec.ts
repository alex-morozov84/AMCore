import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Queue } from 'bullmq'
import { z } from 'zod'

import { aiRunsWork } from '../ai/runs/ai-runs.work'
import { JobName } from '../queue/constants/queues.constant'

import { managedEnvelopeSchema } from './managed-job-profile'
import { ManagedProducer } from './managed-producer'
import type { ProducerObserver } from './producer-observer'
import { defineWork } from './work-definition'
import { WorkReadiness } from './work-readiness'

const ordinaryWork = defineWork({
  id: 'image',
  definitionVersion: 1,
  kind: 'ordinary',
  queue: { name: 'image', enabled: true },
  jobs: {
    render: {
      wireVersion: 1,
      schema: z.object({}),
      replay: { kind: 'idempotent', policyVersion: 1 },
      project: () => ({}),
      retention: { completedMs: 1000, failedMs: 1000 },
    },
  },
})

/** Runs one producer `add` against a fake queue and returns the envelope it stored. */
async function produce(
  definition: typeof ordinaryWork | typeof aiRunsWork,
  jobName: string,
  payload: object,
  correlationId: string | undefined,
  duplicateOf?: string
): Promise<{ envelope: Record<string, unknown>; enqueued: jest.Mock }> {
  const add = jest.fn(async (_name: string, _data: unknown, _options: unknown) => ({ id: 'j1' }))
  const evalRedis = jest
    .fn()
    .mockResolvedValueOnce(['initialized', '019a1234-1234-7123-8123-123456789012'])
    .mockImplementationOnce(async () => {
      const stored = { ...(add.mock.calls[0]![1] as Record<string, unknown>) }
      if (duplicateOf) stored.incarnation = duplicateOf
      return JSON.stringify(stored)
    })
  const queue = {
    name: 'q',
    keys: {},
    toKey: (id: string) => `amcore:q:${id}`,
    getBackend: () => ({ client: Promise.resolve({ eval: evalRedis }) }),
    add,
  } as unknown as Queue
  const readiness = new WorkReadiness()
  readiness.open()
  const enqueued = jest.fn()
  const observer: ProducerObserver = { correlationId: () => correlationId, enqueued }
  await new ManagedProducer(definition as never, queue, readiness, observer).add(
    jobName as never,
    payload as never
  )
  return { envelope: add.mock.calls[0]![1] as Record<string, unknown>, enqueued }
}

describe('managed job envelope contract', () => {
  const schemaKeys = Object.keys(managedEnvelopeSchema.shape)

  it('stores the request ID in schema key order and round-trips byte for byte', async () => {
    const { envelope } = await produce(ordinaryWork, 'render', {}, 'req-1')

    expect(Object.keys(envelope)).toEqual(schemaKeys)
    expect(envelope.correlationId).toBe('req-1')
    // The executor compares JSON.stringify(parsed envelope) with the stored data.
    expect(JSON.stringify(managedEnvelopeSchema.parse(envelope))).toBe(JSON.stringify(envelope))
  })

  it('omits the key, not sets it empty, when no request owns the job', async () => {
    const { envelope } = await produce(ordinaryWork, 'render', {}, undefined)

    expect('correlationId' in envelope).toBe(false)
    expect(Object.keys(envelope)).toEqual(schemaKeys.filter((key) => key !== 'correlationId'))
    expect(JSON.stringify(managedEnvelopeSchema.parse(envelope))).toBe(JSON.stringify(envelope))
  })

  it('never stamps a wake job, even inside a request', async () => {
    const { envelope } = await produce(aiRunsWork, JobName.AI_RUN_WAKE, { runId: 'r1' }, 'req-1')

    expect('correlationId' in envelope).toBe(false)
  })

  it.each(['has space', 'a'.repeat(129), '', 'semi;colon'])(
    'rejects the malformed ID %j on the reader side',
    (value) => {
      const base = {
        protocolVersion: 1,
        incarnation: '019a1234-1234-7123-8123-123456789012',
        jobVersion: 1,
        executionPolicyVersion: 1,
        createdAt: 1,
        payload: {},
      }
      expect(managedEnvelopeSchema.safeParse({ ...base, correlationId: value }).success).toBe(false)
      expect(managedEnvelopeSchema.safeParse({ ...base, correlationId: 'ok-1' }).success).toBe(true)
    }
  )

  it('keeps the strict reader: an unknown key is rejected (reader-first rollout)', () => {
    const envelope = {
      protocolVersion: 1,
      incarnation: '019a1234-1234-7123-8123-123456789012',
      jobVersion: 1,
      executionPolicyVersion: 1,
      createdAt: 1,
      payload: {},
      futureField: 'x',
    }
    expect(managedEnvelopeSchema.safeParse(envelope).success).toBe(false)
  })

  it('logs job.enqueued with duplicate=false for a new job', async () => {
    const { enqueued } = await produce(ordinaryWork, 'render', {}, 'req-1')

    expect(enqueued).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'j1', jobName: 'render', duplicate: false })
    )
  })

  it('logs duplicate=true and the first incarnation when an existing job wins', async () => {
    const first = '019a9999-1234-7123-8123-123456789012'
    const { enqueued } = await produce(ordinaryWork, 'render', {}, 'req-2', first)

    expect(enqueued).toHaveBeenCalledWith(
      expect.objectContaining({ incarnation: first, duplicate: true })
    )
  })

  it('lets every Lua reader touch only fields the schema declares', () => {
    const dir = join(process.cwd(), 'src/infrastructure/background-work/scripts')
    const fields = new Set<string>()
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.lua.ts')))
      for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/envelope\.(\w+)/g))
        fields.add(match[1]!)

    expect(fields.size).toBeGreaterThan(0)
    for (const field of fields) expect(schemaKeys).toContain(field)
  })
})
