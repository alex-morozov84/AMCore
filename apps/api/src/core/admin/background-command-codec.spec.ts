import { v7 as uuidv7 } from 'uuid'

import { assertNewWorkCommandTime } from './background-command-codec'

describe('new background command time bounds', () => {
  const now = new Date('2026-10-09T12:00:00Z')
  it.each([-86400000, 300000])('accepts inclusive timestamp boundary %i', (offset) => {
    expect(() =>
      assertNewWorkCommandTime(uuidv7({ msecs: now.getTime() + offset }), now)
    ).not.toThrow()
  })
  it.each([-86400001, 300001])('refuses timestamp outside the bound %i', (offset) => {
    expect(() => assertNewWorkCommandTime(uuidv7({ msecs: now.getTime() + offset }), now)).toThrow(
      expect.objectContaining({ errorCode: 'COMMAND_EXPIRED' })
    )
  })
})
