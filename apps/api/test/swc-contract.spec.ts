import { beforeAll, describe, expect, it, jest } from '@jest/globals'
import { Injectable, Optional } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import 'reflect-metadata'

@Injectable()
class Dependency {
  value = 'injected'
}

@Injectable()
class Consumer {
  constructor(readonly dependency: Dependency) {}
}

@Injectable()
class OptionalConsumer {
  constructor(@Optional() readonly dependency?: Dependency) {}
}

const history = jest.fn<() => void>()
beforeAll(() => {
  history()
})

describe('SWC runner contract', () => {
  it('retains beforeAll mock history', () => {
    expect(history).toHaveBeenCalledTimes(1)
  })
  it('does not clear beforeAll history before the next test', () => {
    expect(history).toHaveBeenCalledTimes(1)
  })
  it('emits constructor metadata used by Nest DI', async () => {
    const module = await Test.createTestingModule({ providers: [Dependency, Consumer] }).compile()
    try {
      expect(module.get(Consumer).dependency.value).toBe('injected')
    } finally {
      await module.close()
    }
  })
  it('rejects an absent required provider instead of injecting undefined', async () => {
    await expect(Test.createTestingModule({ providers: [Consumer] }).compile()).rejects.toThrow()
  })
  it('preserves Optional metadata for an absent provider', async () => {
    const module = await Test.createTestingModule({ providers: [OptionalConsumer] }).compile()
    try {
      expect(module.get(OptionalConsumer).dependency).toBeUndefined()
    } finally {
      await module.close()
    }
  })
})
