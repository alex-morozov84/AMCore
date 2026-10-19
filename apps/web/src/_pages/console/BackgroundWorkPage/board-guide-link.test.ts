import { describe, expect, it } from 'vitest'

import { QUEUE_BOARD_GUIDE_HREF } from './board-guide-link'

describe('QUEUE_BOARD_GUIDE_HREF', () => {
  it('keeps the address it had before the shared repository address', () => {
    expect(QUEUE_BOARD_GUIDE_HREF).toBe(
      'https://github.com/alex-morozov84/AMCore/blob/main/docs/operations-console/queue-board.md#enabling-the-board'
    )
  })
})
