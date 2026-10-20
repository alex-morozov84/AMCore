import { describe, expect, it } from 'vitest'

import {
  assertConsoleLogSearchTarget,
  CONSOLE_LOG_SEARCH_ENV,
  getConsoleLogSearchTarget,
} from './console-log-search-target'

describe('getConsoleLogSearchTarget', () => {
  it.each([undefined, '', '   '])('gives no target for the unset value %j', (value) => {
    expect(getConsoleLogSearchTarget({ [CONSOLE_LOG_SEARCH_ENV]: value })).toBeNull()
  })

  it('gives the normalized address, loopback http included (the SSH tunnel of the overlay)', () => {
    expect(
      getConsoleLogSearchTarget({ [CONSOLE_LOG_SEARCH_ENV]: ' http://localhost:3002 ' })
    ).toEqual({ kind: 'grafana-loki', baseUrl: 'http://localhost:3002/' })
    expect(
      getConsoleLogSearchTarget({ [CONSOLE_LOG_SEARCH_ENV]: 'https://logs.example.com/grafana' })
    ).toEqual({ kind: 'grafana-loki', baseUrl: 'https://logs.example.com/grafana' })
  })

  it.each([
    'http://logs.example.com',
    'https://user:pw@logs.example.com',
    'https://*.example.com',
    'javascript:alert(1)',
    'logs.example.com',
  ])('gives no target for the unsafe value %s', (value) => {
    expect(getConsoleLogSearchTarget({ [CONSOLE_LOG_SEARCH_ENV]: value })).toBeNull()
  })
})

describe('assertConsoleLogSearchTarget', () => {
  it('accepts unset, blank and usable values', () => {
    for (const value of [
      undefined,
      '',
      '  ',
      'https://logs.example.com',
      'http://localhost:3002',
    ]) {
      expect(() => assertConsoleLogSearchTarget({ [CONSOLE_LOG_SEARCH_ENV]: value })).not.toThrow()
    }
  })

  it('names the setting when a set value is unusable', () => {
    expect(() =>
      assertConsoleLogSearchTarget({ [CONSOLE_LOG_SEARCH_ENV]: 'http://logs.example.com' })
    ).toThrow(CONSOLE_LOG_SEARCH_ENV)
  })
})
