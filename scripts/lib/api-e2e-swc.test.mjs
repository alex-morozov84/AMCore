import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateAttempt, isOrdinaryFailure } from '../api-e2e/validate.mjs'
import { exercise } from './api-e2e-swc-fixture.mjs'

test('actual Jest+SWC ESM metadata fixture completes naturally in the owned process', async () => {
  const attempt = await exercise(
    'clean',
    `
    import 'reflect-metadata';
    import { Injectable } from '@nestjs/common';
    @Injectable() class Dependency {}
    @Injectable() class Consumer { constructor(readonly dependency: Dependency) {} }
    test('SWC decorator metadata',()=>{
      expect(Reflect.getMetadata('design:paramtypes',Consumer)).toEqual([Dependency]);
    });
  `
  )
  assert.equal(attempt.exit, 0)
  validateAttempt(attempt)
  assert.equal(attempt.forced, false)
  assert.equal(attempt.signal, null)
  assert.equal(attempt.spawns, 1)
  assert.throws(() => process.kill(-attempt.pid, 0), { code: 'ESRCH' })
})

for (const [id, setup] of [
  ['leaked-timer', ''],
  ['signal-handler-zero', ''],
]) {
  test(`actual Jest+SWC refuses ${id} after passed assertions`, async () => {
    const attempt = await exercise(
      id,
      `${setup}
      test('unfinished timer',()=>{setInterval(()=>{},1000);expect(1).toBe(1)});
    `
    )
    assert.equal(attempt.final.success, true)
    assert.equal(attempt.forced, true)
    assert.equal(attempt.exit, id === 'signal-handler-zero' ? 0 : null)
    assert.throws(() => validateAttempt(attempt), /Abnormal\/forced/)
    assert.throws(() => process.kill(-attempt.pid, 0), { code: 'ESRCH' })
  })
}

test('actual Jest+SWC refuses a process crash without terminal evidence', async () => {
  const attempt = await exercise('crash', "test('crash',()=>process.exit(7))")
  assert.equal(attempt.exit, 7)
  assert.equal(attempt.final, null)
  assert.throws(() => validateAttempt(attempt))
})

test('actual Jest+SWC ordinary assertion failure remains a safe non-success', async () => {
  const attempt = await exercise('assertion-failure', "test('failure',()=>expect(1).toBe(2))")
  assert.equal(attempt.exit, 1)
  assert.equal(isOrdinaryFailure(attempt), true)
  assert.throws(() => validateAttempt(attempt))
})
