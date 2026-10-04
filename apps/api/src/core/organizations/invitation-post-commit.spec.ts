import { INVITATION_POST_COMMIT_TIMEOUT_MS, invitationPostCommit } from './invitation-post-commit'

describe('bounded invitation post-commit effects', () => {
  afterEach(() => jest.useRealTimers())
  it.each(['resolve', 'reject'] as const)(
    'bounds a stalled effect and handles late %s',
    async (late) => {
      jest.useFakeTimers()
      let resolve!: () => void
      let reject!: (reason: unknown) => void
      const stalled = new Promise<void>((yes, no) => {
        resolve = yes
        reject = no
      })
      const work = jest.fn(() => stalled)
      const result = invitationPostCommit(work)
      await jest.advanceTimersByTimeAsync(INVITATION_POST_COMMIT_TIMEOUT_MS - 1)
      let settled = false
      void result.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      expect(await result).toBe('timeout')
      if (late === 'resolve') resolve()
      else reject(new Error('secret-bearing late provider failure'))
      await Promise.resolve()
      expect(await result).toBe('timeout')
      expect(work).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    }
  )
  it('categorizes synchronous and asynchronous rejection without returning the error', async () => {
    expect(
      await invitationPostCommit(() => {
        throw new Error('secret')
      })
    ).toBe('failed')
    expect(await invitationPostCommit(() => Promise.reject(new Error('secret')))).toBe('failed')
  })
})
