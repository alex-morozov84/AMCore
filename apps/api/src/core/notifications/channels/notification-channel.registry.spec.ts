import { Module } from '@nestjs/common'
import { z } from 'zod'

import { NotificationChannelRegistry } from './notification-channel.registry'
import type { NotificationChannelDescriptor } from './notification-channel.types'

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
    ])
      expect(
        () =>
          new NotificationChannelRegistry(
            [{ ...descriptor, ...invalid } as unknown as NotificationChannelDescriptor],
            env
          )
      ).toThrow()
  })
})
