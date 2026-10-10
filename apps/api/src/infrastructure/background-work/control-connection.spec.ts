import { ControlConnection } from './control-connection'
import { CONTROL_LIMITS } from './control-limits'

import { AppException } from '@/common/exceptions'
import type { EnvService } from '@/env/env.service'

describe('Control connection capacity', () => {
  it('refuses admission with a closed 503 without creating or releasing another lease', async () => {
    const previous = Reflect.get(ControlConnection, 'leases')
    const get = jest.fn()
    Reflect.set(ControlConnection, 'leases', CONTROL_LIMITS.concurrentDispatches)
    try {
      const connection = new ControlConnection({ get } as unknown as EnvService)
      const action = jest.fn()
      const failure = await connection.withClient(action).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AppException)
      expect((failure as AppException).getStatus()).toBe(503)
      expect((failure as AppException).getResponse()).toMatchObject({
        errorCode: 'WORK_UNAVAILABLE',
      })
      expect(get).not.toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
      expect(Reflect.get(ControlConnection, 'leases')).toBe(CONTROL_LIMITS.concurrentDispatches)
    } finally {
      Reflect.set(ControlConnection, 'leases', previous)
    }
  })
})
