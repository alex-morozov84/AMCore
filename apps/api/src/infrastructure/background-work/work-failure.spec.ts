import { UnrecoverableError } from 'bullmq'
import { z } from 'zod'

import { defineOrdinaryWork } from './work-definition'
import {
  currentWorkFailure,
  isPermanentWorkFailure,
  resolveWorkFailure,
  WorkFailure,
  workFailureCode,
} from './work-failure'

const descriptor = {
  id: 'failure-proof',
  definitionVersion: 1,
  queue: { name: 'failure-proof', enabled: true },
  jobs: {
    run: {
      wireVersion: 1,
      schema: z.object({}),
      replay: { kind: 'idempotent' as const, policyVersion: 1 },
      project: () => ({}),
      retention: { completedMs: 1, failedMs: 1 },
    },
  },
  failureReasons: { invalid_file: { title: { en: 'Invalid file', ru: 'Некорректный файл' } } },
}
const definition = defineOrdinaryWork(descriptor)
const incarnation = '019a1234-1234-7123-8123-123456789012'
const invocationId = '019a1234-1234-7123-8123-123456789013'
const fields = {
  amIncarnation: incarnation,
  amInvocationId: invocationId,
  amMetadata: JSON.stringify({
    version: 1,
    report: 'failure',
    invocationId,
    failureCode: 'invalid_file',
  }),
}

describe('safe registered failure diagnostics', () => {
  it('snapshots the catalogue and resolves own registered identifiers only', () => {
    descriptor.failureReasons.invalid_file.title.en = 'Changed after registration'
    expect(resolveWorkFailure(definition, 'invalid_file')?.title.en).toBe('Invalid file')
    expect(Object.isFrozen(definition.failureReasons!.invalid_file!.title)).toBe(true)
    for (const code of ['toString', '__proto__', 'missing', 'secret://token'])
      expect(resolveWorkFailure(definition, code)).toBeUndefined()
    expect(workFailureCode(definition, new Error('secret://token'))).toBeUndefined()
  })
  it('preserves explicit permanence independently of code recognition', () => {
    for (const code of ['invalid_file', 'undeclared', 'secret://token']) {
      expect(isPermanentWorkFailure(new WorkFailure(code, { permanent: true }))).toBe(true)
      expect(isPermanentWorkFailure(new WorkFailure(code, { permanent: false }))).toBe(false)
    }
    expect(isPermanentWorkFailure(new UnrecoverableError('private cause'))).toBe(true)
    expect(isPermanentWorkFailure(new Error('private cause'))).toBe(false)
  })
  it('cannot attach a stale cause to a changed incarnation/invocation or new job state', () => {
    expect(currentWorkFailure(definition, 'failed', incarnation, fields)?.code).toBe('invalid_file')
    for (const state of ['waiting', 'active', 'completed'])
      expect(currentWorkFailure(definition, state, incarnation, fields)).toBeUndefined()
    expect(currentWorkFailure(definition, 'failed', invocationId, fields)).toBeUndefined()
    expect(
      currentWorkFailure(definition, 'failed', incarnation, {
        ...fields,
        amInvocationId: incarnation,
      })
    ).toBeUndefined()
    for (const amMetadata of [
      '',
      '{',
      JSON.stringify({ report: 'unrecorded', invocationId }),
      JSON.stringify({ report: 'failure', invocationId, failureCode: 'removed' }),
    ])
      expect(
        currentWorkFailure(definition, 'failed', incarnation, { ...fields, amMetadata })
      ).toBeUndefined()
  })
})
