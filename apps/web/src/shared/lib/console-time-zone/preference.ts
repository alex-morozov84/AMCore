import 'client-only'

export type ConsoleTimeZoneMode = 'utc' | 'local'
export const CONSOLE_TIME_ZONE_KEY = 'amcore-console-time-zone'
const CHANGE_EVENT = 'amcore-console-time-zone-change'

export function readConsoleBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function readConsoleTimeZone(): ConsoleTimeZoneMode {
  try {
    return window.localStorage.getItem(CONSOLE_TIME_ZONE_KEY) === 'local' ? 'local' : 'utc'
  } catch {
    return 'utc'
  }
}

export function writeConsoleTimeZone(mode: ConsoleTimeZoneMode) {
  try {
    window.localStorage.setItem(CONSOLE_TIME_ZONE_KEY, mode)
  } catch {
    /* Unavailable storage retains the UTC fallback. */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeConsoleTimeZone(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONSOLE_TIME_ZONE_KEY) notify()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, notify)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, notify)
  }
}
