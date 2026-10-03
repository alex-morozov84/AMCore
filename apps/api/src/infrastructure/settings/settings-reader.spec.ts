import type { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

import type { SettingRow } from './setting-definition'
import { testDefinition } from './setting-definition.fixture'
import { SettingRegistry } from './setting-registry'
import type { SettingRepository } from './setting-repository'
import { SettingsReader } from './settings-reader'

describe('shared settings reader', () => {
  const definition = testDefinition('test.boolean', z.boolean(), false)
  const row = (revision = 0, value: boolean | undefined = undefined): SettingRow => ({
    key: definition.key,
    schemaVersion: 1,
    revision,
    override: value === undefined ? null : { value },
  })
  function setup() {
    const refresh = jest.fn<Promise<SettingRow[]>, [readonly string[]]>()
    const registry = new SettingRegistry([definition])
    const reader = new SettingsReader(
      registry,
      { refresh } as unknown as SettingRepository,
      { warn: jest.fn(), info: jest.fn() } as unknown as PinoLogger
    )
    return { reader, refresh }
  }
  afterEach(() => jest.useRealTimers())

  it('retains confirmed state across failures, rejects regression, and recovers', async () => {
    const { reader, refresh } = setup()
    expect(reader.snapshot(definition)).toMatchObject({
      revision: null,
      source: 'unconfirmed',
      value: false,
    })
    refresh.mockResolvedValueOnce([row(2, true)])
    await reader.refresh()
    refresh.mockRejectedValueOnce(new Error('unavailable'))
    await reader.refresh()
    expect(reader.snapshot(definition)).toMatchObject({
      revision: 2,
      value: true,
      refreshStatus: 'failed',
    })
    refresh.mockResolvedValueOnce([row(1)])
    await reader.refresh()
    expect(reader.snapshot(definition).revision).toBe(2)
    refresh.mockResolvedValueOnce([row(3)])
    await reader.refresh()
    expect(reader.snapshot(definition)).toMatchObject({
      revision: 3,
      value: false,
      source: 'baseline',
      refreshStatus: 'confirmed',
    })
    reader.onModuleDestroy()
  })

  it('releases the caller deadline without releasing unsettled query ownership or accepting late data', async () => {
    jest.useFakeTimers()
    const { reader, refresh } = setup()
    let settle!: (rows: SettingRow[]) => void
    refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const first = reader.refresh()
    await jest.advanceTimersByTimeAsync(5001)
    await first
    expect(reader.snapshot(definition).refreshStatus).toBe('failed')
    void reader.refresh()
    await jest.advanceTimersByTimeAsync(90_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    settle([row(1, true)])
    await jest.advanceTimersByTimeAsync(1)
    expect(reader.snapshot(definition).revision).toBeNull()
    refresh.mockResolvedValueOnce([row(2, true)])
    await reader.refresh()
    expect(reader.snapshot(definition).revision).toBe(2)
    reader.onModuleDestroy()
  })

  it('handles missing rows, invalid known data and unknown keys without activating them', async () => {
    const { reader, refresh } = setup()
    refresh.mockResolvedValueOnce([{ ...row(), key: 'unknown.setting' }])
    await reader.refresh()
    expect(reader.snapshot(definition).refreshStatus).toBe('failed')
    refresh.mockResolvedValueOnce([{ ...row(), override: { value: 'wrong' } }])
    await reader.refresh()
    expect(reader.snapshot(definition).revision).toBeNull()
    refresh.mockResolvedValueOnce([row()])
    await reader.refresh()
    expect(reader.snapshot(definition).source).toBe('baseline')
    reader.onModuleDestroy()
  })

  it('does not read the repository for snapshots and detects expired confirmation', async () => {
    jest.useFakeTimers()
    const { reader, refresh } = setup()
    refresh.mockResolvedValue([row()])
    await reader.refresh()
    await jest.advanceTimersByTimeAsync(60_001)
    for (let i = 0; i < 100; i++) expect(reader.snapshot(definition).refreshStatus).toBe('stale')
    expect(refresh).toHaveBeenCalledTimes(1)
    reader.onModuleDestroy()
  })

  it('retries missed ticks immediately after actual settlement and ignores shutdown results', async () => {
    jest.useFakeTimers()
    const { reader, refresh } = setup()
    let settle!: (rows: SettingRow[]) => void
    refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const initial = reader.initialize()
    await jest.advanceTimersByTimeAsync(65_000)
    await initial
    refresh.mockResolvedValueOnce([row(2, true)])
    settle([row(1)])
    await jest.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(reader.snapshot(definition).revision).toBe(2)
    refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const last = reader.refresh()
    await jest.advanceTimersByTimeAsync(1)
    reader.onModuleDestroy()
    settle([row(3)])
    await last
    expect(reader.snapshot(definition).revision).toBe(2)
  })

  it('keeps consumer applied state on failure and retries the same confirmed revision', async () => {
    const { reader, refresh } = setup()
    let applied = false
    const consumer = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('consumer failure')
      })
      .mockImplementation(() => {
        applied = reader.snapshot(definition).value
      })
    reader.subscribe(definition, consumer)
    refresh.mockResolvedValue([row(1, true)])
    await reader.refresh()
    expect(applied).toBe(false)
    await reader.refresh()
    expect(applied).toBe(true)
    reader.onModuleDestroy()
  })
})
