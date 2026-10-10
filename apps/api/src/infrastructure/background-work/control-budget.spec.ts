import { admitControlBudget } from './control-budget'
import { CONTROL_RATES } from './control-limits'

describe('Fixed PG control-budget arithmetic', () => {
  it('allows three initial actor requests, then requires six seconds', () => {
    let virtualTime = 0
    for (let i = 0; i < 3; i += 1) {
      const decision = admitControlBudget(virtualTime, 100000, CONTROL_RATES.actorRequests)
      if (!decision.accepted) throw new Error('Expected burst admission')
      virtualTime = decision.virtualTime
    }
    expect(admitControlBudget(virtualTime, 100000, CONTROL_RATES.actorRequests)).toEqual({
      accepted: false,
      retryAfterMs: 6000,
    })
    expect(admitControlBudget(virtualTime, 106000, CONTROL_RATES.actorRequests).accepted).toBe(true)
  })

  it('charges the whole batch against the shared target burst', () => {
    const first = admitControlBudget(0, 100000, CONTROL_RATES.actorWorkTargets, 50)
    if (!first.accepted) throw new Error('Expected batch admission')
    expect(
      admitControlBudget(first.virtualTime, 100000, CONTROL_RATES.actorWorkTargets, 1)
    ).toEqual({ accepted: false, retryAfterMs: 600 })
    expect(admitControlBudget(0, 100000, CONTROL_RATES.actorWorkTargets, 51).accepted).toBe(false)
  })

  it.each([NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1])(
    'refuses an uncertain clock %p',
    (dbNow) => {
      expect(() => admitControlBudget(0, dbNow, CONTROL_RATES.globalRequests)).toThrow(
        'CLOCK_UNCERTAIN'
      )
    }
  )
})
