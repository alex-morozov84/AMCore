import { Module } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { z } from 'zod'

import type { NotificationDefinitionRegistry } from '../notification-definition.registry'

import { NotificationChannelRegistry } from './notification-channel.registry'
import type { NotificationChannelDescriptor } from './notification-channel.types'
import { NotificationControlTargets } from './notification-control-targets'

import type { EnvService } from '@/env/env.service'
@Module({})
class Reader {}
const descriptor: NotificationChannelDescriptor = {
  id: 'test_channel',
  targetMode: 'snapshot',
  core: { module: Reader, token: Reader },
  worker: () => ({ module: Reader }),
  delivererToken: Reader,
  available: () => false,
  wireVersion: 1,
  requestSchema: z.object({}),
  requestTargetsDelivery: () => true,
}
const env = {} as EnvService
describe('Single channel descriptor contract', () => {
  it('projects registered availability while keeping in-app always available', () => {
    const registry = new NotificationChannelRegistry([descriptor], env)
    expect(registry.available('test_channel')).toBe(false)
    expect(registry.available('in_app')).toBe(true)
    expect(registry.ids()).toEqual(['in_app', 'test_channel'])
  })
  it('refuses duplicate/reserved identifiers and missing runtime contracts', () => {
    expect(() => new NotificationChannelRegistry([descriptor, descriptor], env)).toThrow()
    for (const invalid of [
      { id: 'in_app' },
      { id: 'Bad-ID' },
      { targetMode: 'unknown' },
      { available: null },
      { requestTargetsDelivery: null },
      { worker: null },
      { wireVersion: 2 },
      { manualRetry: {} },
      { manualRetry: { validatorToken: Reader } },
      { manualRetry: { validatorToken: Reader, requestIdentity: () => ({}), providerScope: null } },
    ])
      expect(
        () =>
          new NotificationChannelRegistry(
            [{ ...descriptor, ...invalid } as unknown as NotificationChannelDescriptor],
            env
          )
      ).toThrow()
  })
  it.each([
    ['missing', undefined],
    ['wrong channel', { channel: 'another', validateDelivery: () => null }],
    ['missing method', { channel: descriptor.id }],
  ])(
    'refuses a %s core manual validator through real Nest provider resolution',
    async (_name, validator) => {
      const registry = new NotificationChannelRegistry(
        [
          {
            ...descriptor,
            manualRetry: {
              validatorToken: Reader,
              requestIdentity: () => ({ binding: 'fixture', path: '/', idempotencyKey: null }),
            },
          },
        ],
        env
      )
      const app = await Test.createTestingModule({
        providers: [
          {
            provide: NotificationControlTargets,
            inject: [ModuleRef],
            useFactory: (modules: ModuleRef) =>
              new NotificationControlTargets(
                registry,
                modules,
                {} as NotificationDefinitionRegistry,
                env
              ),
          },
          ...(validator ? [{ provide: Reader, useValue: validator }] : []),
        ],
      }).compile()
      try {
        expect(() => app.get(NotificationControlTargets).onModuleInit()).toThrow()
      } finally {
        await app.close()
      }
    }
  )
  it('allows an explicitly unsupported manual retry without resolving a validator', async () => {
    const modules = { get: jest.fn() } as unknown as ModuleRef
    const targets = new NotificationControlTargets(
      new NotificationChannelRegistry([descriptor], env),
      modules,
      {} as NotificationDefinitionRegistry,
      env
    )
    targets.onModuleInit()
    expect(modules.get).not.toHaveBeenCalled()
  })
})
