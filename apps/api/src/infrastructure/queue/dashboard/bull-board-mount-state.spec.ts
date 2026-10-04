import { resolveBullBoardMount } from './bull-board-mount-state'

describe('resolveBullBoardMount (one startup decision)', () => {
  it('mounts outside production', () => {
    expect(resolveBullBoardMount({ NODE_ENV: 'development' })).toEqual({
      mounted: true,
      reason: 'mounted',
    })
  })

  it('does not mount in production without the explicit process flag', () => {
    expect(resolveBullBoardMount({ NODE_ENV: 'production' })).toEqual({
      mounted: false,
      reason: 'disabled_in_production',
    })
    expect(resolveBullBoardMount({ NODE_ENV: 'production', ENABLE_BULL_BOARD: 'false' })).toEqual({
      mounted: false,
      reason: 'disabled_in_production',
    })
  })

  it('mounts in production only for the literal "true"', () => {
    expect(
      resolveBullBoardMount({ NODE_ENV: 'production', ENABLE_BULL_BOARD: 'true' }).mounted
    ).toBe(true)
    expect(
      resolveBullBoardMount({ NODE_ENV: 'production', ENABLE_BULL_BOARD: 'TRUE' }).mounted
    ).toBe(false)
  })

  it('never mounts on the worker role and says so', () => {
    expect(resolveBullBoardMount({ NODE_ENV: 'development', PROCESS_ROLE: 'worker' })).toEqual({
      mounted: false,
      reason: 'worker_role',
    })
    expect(
      resolveBullBoardMount({
        NODE_ENV: 'production',
        ENABLE_BULL_BOARD: 'true',
        PROCESS_ROLE: 'worker',
      }).reason
    ).toBe('worker_role')
  })

  it('role all and web keep the normal rules', () => {
    for (const PROCESS_ROLE of ['all', 'web', undefined]) {
      expect(resolveBullBoardMount({ NODE_ENV: 'production', PROCESS_ROLE }).mounted).toBe(false)
      expect(resolveBullBoardMount({ NODE_ENV: 'test', PROCESS_ROLE }).mounted).toBe(true)
    }
  })

  it('freezes the module-level snapshot against later env changes', async () => {
    const original = { ...process.env }
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.ENABLE_BULL_BOARD
      delete process.env.PROCESS_ROLE
      jest.resetModules()
      const { BULL_BOARD_MOUNT } = await import('./bull-board-mount-state')
      expect(BULL_BOARD_MOUNT.mounted).toBe(false)
      // A later load of `.env` (ConfigModule) cannot change the decision already taken.
      process.env.ENABLE_BULL_BOARD = 'true'
      expect(BULL_BOARD_MOUNT.mounted).toBe(false)
      expect(Object.isFrozen(BULL_BOARD_MOUNT)).toBe(true)
    } finally {
      process.env = original
      jest.resetModules()
    }
  })
})
