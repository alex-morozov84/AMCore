import type { ModuleRef } from '@nestjs/core'
import type { Job, Queue } from 'bullmq'
import { CLS_ID, type ClsService } from 'nestjs-cls'
import { z } from 'zod'

import { managedProcessor } from './managed-processor'
import { defineWork } from './work-definition'
import type { WorkExecutionService } from './work-execution.service'

const definition = defineWork({
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

describe('managed processor log context', () => {
  const handler = { run: async () => undefined }
  const modules = { get: () => handler } as unknown as ModuleRef
  const job = { id: 'job-1', name: 'render', data: { correlationId: 'req-1' } } as unknown as Job
  const build = (cls?: ClsService, run = jest.fn(async () => undefined)) => {
    const execution = { discardSecret: () => false, run } as unknown as WorkExecutionService
    const Processor = managedProcessor(definition) as unknown as new (...args: unknown[]) => {
      process(job: Job, token?: string): Promise<void>
    }
    return { processor: new Processor({} as Queue, execution, modules, cls), run }
  }

  it('runs the job inside a context carrying the request ID, work ID and job ID', async () => {
    const runWith = jest.fn((_store: object, callback: () => unknown) => callback())
    const { processor, run } = build({ runWith } as unknown as ClsService)

    await processor.process(job, 'token')

    expect(runWith).toHaveBeenCalledWith(
      { [CLS_ID]: 'req-1', workId: 'image', jobId: 'job-1' },
      expect.any(Function)
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('still runs a job when no CLS service is provided', async () => {
    const { processor, run } = build(undefined)

    await processor.process(job, 'token')

    expect(run).toHaveBeenCalledTimes(1)
  })
})
