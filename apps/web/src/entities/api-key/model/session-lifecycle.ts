import { getErrorStatus } from '@/shared/api/errors'

import 'client-only'

export type OwnKeySessionState = 'unverified' | 'verified' | 'retired'
export class OwnKeySession {
  private verificationFailed = false
  getFailureSnapshot = () => this.verificationFailed
  private epoch = 0
  private verificationGeneration = 0
  private state: OwnKeySessionState = 'unverified'
  private probe?: Promise<boolean>
  private listeners = new Set<() => void>()
  constructor(private readonly verify: () => Promise<unknown>) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.state
  capture = () => this.epoch
  current = (epoch: number) => epoch === this.epoch && this.state !== 'retired'
  private publish(state: OwnKeySessionState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
  conceal() {
    this.verificationFailed = false
    this.verificationGeneration++
    if (this.state !== 'retired') this.publish('unverified')
  }
  invalidate() {
    this.epoch++
    this.conceal()
  }
  retire() {
    this.epoch++
    this.publish('retired')
  }
  /** Coalesce only concurrent probes. Callers needing a post-command probe await any earlier one first. */
  check(): Promise<boolean> {
    if (this.state === 'retired') return Promise.resolve(false)
    if (this.probe) return this.probe
    this.verificationFailed = false
    this.publish(this.state)
    const epoch = this.epoch
    const generation = this.verificationGeneration
    this.probe = this.verify()
      .then(
        () => {
          if (!this.current(epoch) || generation !== this.verificationGeneration) return false
          this.publish('verified')
          return true
        },
        (error) => {
          if (this.current(epoch) && generation === this.verificationGeneration) {
            if ([401, 409].includes(getErrorStatus(error) ?? 0)) this.retire()
            else {
              this.conceal()
              this.verificationFailed = true
              this.publish('unverified')
            }
          }
          return false
        }
      )
      .finally(() => {
        this.probe = undefined
      })
    return this.probe
  }
  async freshCheck(conceal = false) {
    const previous = this.probe
    if (conceal) this.conceal()
    await previous
    return this.check()
  }
}

/** A pagehide invalidates attempts; pageshow remains installed for BFCache restoration. */
export function observeOwnKeySession(
  session: OwnKeySession,
  active: () => boolean,
  discard: () => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const foreground = () => document.visibilityState === 'visible' && document.hasFocus()
  const schedule = () => {
    clearTimeout(timer)
    if (active() && foreground() && session.getSnapshot() !== 'retired')
      timer = setTimeout(() => {
        if (active()) void check(false)
      }, 5000)
  }
  const check = async (fresh = true) => {
    if (foreground()) await (fresh ? session.freshCheck(true) : session.check())
    schedule()
  }
  const conceal = () => {
    clearTimeout(timer)
    session.conceal()
  }
  const visibility = () => {
    if (foreground()) void check()
    else conceal()
  }
  const pagehide = () => {
    conceal()
    session.invalidate()
    discard()
  }
  const unsubscribe = session.subscribe(schedule)
  window.addEventListener('focus', visibility)
  window.addEventListener('blur', conceal)
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('pageshow', visibility)
  document.addEventListener('visibilitychange', visibility)
  void check()
  return () => {
    clearTimeout(timer)
    unsubscribe()
    session.invalidate()
    discard()
    window.removeEventListener('focus', visibility)
    window.removeEventListener('blur', conceal)
    window.removeEventListener('pagehide', pagehide)
    window.removeEventListener('pageshow', visibility)
    document.removeEventListener('visibilitychange', visibility)
  }
}
