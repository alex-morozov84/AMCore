import { hasRetiredReadOnlyFlag } from './bull-board-legacy-flag'

describe('retired BULL_BOARD_READ_ONLY flag', () => {
  it('is noticed with any value on the roles that serve the board', () => {
    for (const value of ['false', 'true', '', '0']) {
      expect(hasRetiredReadOnlyFlag({ BULL_BOARD_READ_ONLY: value })).toBe(true)
      expect(hasRetiredReadOnlyFlag({ BULL_BOARD_READ_ONLY: value, PROCESS_ROLE: 'web' })).toBe(
        true
      )
      expect(hasRetiredReadOnlyFlag({ BULL_BOARD_READ_ONLY: value, PROCESS_ROLE: 'all' })).toBe(
        true
      )
    }
  })

  it('is silent when unset and on the worker role', () => {
    expect(hasRetiredReadOnlyFlag({})).toBe(false)
    expect(hasRetiredReadOnlyFlag({ BULL_BOARD_READ_ONLY: 'false', PROCESS_ROLE: 'worker' })).toBe(
      false
    )
  })
})
