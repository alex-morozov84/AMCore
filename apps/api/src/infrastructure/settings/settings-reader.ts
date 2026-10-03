import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { canonicalValue, decodeSetting, immutable } from './setting-codec'
import type { SettingDefinition, SettingRow, SettingSnapshot } from './setting-definition'
import { SettingRegistry } from './setting-registry'
import { SettingRepository } from './setting-repository'

interface Entry {
  snapshot: SettingSnapshot<unknown>
  override: unknown
}

/** One durable reconciliation loop per process; observations only read memory. */
@Injectable()
export class SettingsReader implements OnModuleInit, OnModuleDestroy {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private flight?: Promise<void>
  private observed?: Promise<void>
  private initial?: Promise<void>
  private timer?: NodeJS.Timeout
  private stopped = false
  private missedTick = false
  private readonly failedListeners = new Set<() => void>()

  constructor(
    private readonly registry: SettingRegistry,
    private readonly repository: SettingRepository,
    private readonly logger: PinoLogger
  ) {
    for (const d of registry.all())
      this.entries.set(d.key, {
        override: undefined,
        snapshot: immutable({
          value: d.schema.parse(d.baseline()),
          revision: null,
          source: 'unconfirmed',
          lastConfirmedAt: null,
          refreshStatus: 'unconfirmed',
        }),
      })
  }

  onModuleInit(): Promise<void> {
    return this.initialize()
  }

  initialize(): Promise<void> {
    if (!this.initial) {
      this.initial = this.refresh()
      this.timer = setInterval(() => {
        if (this.flight) this.missedTick = true
        else void this.refresh()
      }, 30_000)
      this.timer.unref()
    }
    return this.initial
  }

  onModuleDestroy(): void {
    this.stopped = true
    clearInterval(this.timer)
  }

  snapshot<T>(definition: SettingDefinition<T>): SettingSnapshot<T> {
    this.registry.assert(definition)
    const s = this.entries.get(definition.key)!.snapshot as SettingSnapshot<T>
    if (
      s.refreshStatus === 'confirmed' &&
      s.lastConfirmedAt &&
      Date.now() - Date.parse(s.lastConfirmedAt) > 60_000
    )
      return Object.freeze({ ...s, refreshStatus: 'stale' })
    return s
  }

  subscribe<T>(definition: SettingDefinition<T>, listener: () => void): () => void {
    this.registry.assert(definition)
    const listeners = this.listeners.get(definition.key) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(definition.key, listeners)
    return () => {
      listeners.delete(listener)
      this.failedListeners.delete(listener)
    }
  }

  refresh(): Promise<void> {
    if (this.stopped || this.flight) return this.observed ?? Promise.resolve()
    const startedAt = performance.now()
    let expired = false
    let finish!: () => void
    const observed = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.observed = observed
    const deadline = setTimeout(() => {
      expired = true
      if (!this.stopped) this.fail()
      finish()
    }, 5000)
    // The slot belongs to the underlying operation, not the deadline race.
    this.flight = Promise.resolve()
      .then(() => this.repository.refresh(this.registry.all().map((d) => d.key)))
      .then((rows) => {
        if (!expired && !this.stopped) this.accept(rows, startedAt)
      })
      .catch(() => {
        if (!this.stopped) this.fail()
      })
      .finally(() => {
        clearTimeout(deadline)
        this.flight = undefined
        this.observed = undefined
        finish()
        if (this.missedTick && !this.stopped) {
          this.missedTick = false
          queueMicrotask(() => {
            void this.refresh()
          })
        }
      })
    return observed
  }

  private accept(rows: readonly SettingRow[], startedAt: number): void {
    for (const definition of this.registry.all()) {
      try {
        this.acceptOne(
          definition,
          rows.find((row) => row.key === definition.key),
          startedAt
        )
      } catch {
        this.failOne(definition.key)
      }
    }
  }

  private acceptOne(
    definition: SettingDefinition<unknown>,
    row: SettingRow | undefined,
    startedAt: number
  ): void {
    if (!row) throw new Error('Required setting row missing')
    const previous = this.entries.get(definition.key)!
    const override = decodeSetting(definition, row)
    if (performance.now() - startedAt >= 5000) throw new Error('Setting read budget expired')
    if (
      previous.snapshot.revision !== null &&
      (row.revision < previous.snapshot.revision ||
        (row.revision === previous.snapshot.revision &&
          canonicalValue(override) !== canonicalValue(previous.override)))
    ) {
      throw new Error('Setting revision regressed or changed without revision')
    }
    if (previous.snapshot.refreshStatus === 'failed')
      this.logger.info({
        event: 'runtime_setting_refresh_recovered',
        key: definition.key,
        revision: row.revision,
      })
    const source = override === undefined ? 'baseline' : 'override'
    this.entries.set(definition.key, {
      override: immutable(override),
      snapshot: immutable({
        value: override === undefined ? definition.schema.parse(definition.baseline()) : override,
        revision: row.revision,
        source,
        lastConfirmedAt: new Date().toISOString(),
        refreshStatus: 'confirmed',
      }),
    })
    for (const listener of this.listeners.get(definition.key) ?? []) {
      try {
        listener()
        this.failedListeners.delete(listener)
      } catch {
        if (!this.failedListeners.has(listener))
          this.logger.warn({ event: 'runtime_setting_apply_failed', key: definition.key })
        this.failedListeners.add(listener)
      }
    }
  }

  private fail(): void {
    for (const d of this.registry.all()) this.failOne(d.key)
  }

  private failOne(key: string): void {
    const entry = this.entries.get(key)!
    if (entry.snapshot.refreshStatus !== 'failed')
      this.logger.warn({ event: 'runtime_setting_refresh_failed', key })
    this.entries.set(key, {
      ...entry,
      snapshot: immutable({ ...entry.snapshot, refreshStatus: 'failed' }),
    })
  }
}
