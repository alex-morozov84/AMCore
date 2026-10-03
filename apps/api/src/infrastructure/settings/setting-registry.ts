import { Inject, Injectable } from '@nestjs/common'

import { encodeSetting } from './setting-codec'
import type { SettingDefinition } from './setting-definition'
export const SETTING_DEFINITIONS = Symbol('SETTING_DEFINITIONS')

@Injectable()
export class SettingRegistry {
  private readonly definitions = new Map<string, SettingDefinition<unknown>>()

  constructor(@Inject(SETTING_DEFINITIONS) definitions: readonly SettingDefinition<unknown>[]) {
    for (const definition of definitions) {
      if (
        !/^[a-z][A-Za-z0-9.]{2,95}$/.test(definition.key) ||
        !Number.isInteger(definition.schemaVersion) ||
        definition.schemaVersion < 1 ||
        definition.schemaVersion > 2_147_483_647 ||
        definition.scope !== 'platform' ||
        definition.storageKind !== 'ordinary' ||
        definition.failurePolicy !== 'retain-last-confirmed-or-baseline' ||
        this.definitions.has(definition.key)
      )
        throw new Error('Invalid setting definition')
      encodeSetting(definition, definition.baseline())
      this.definitions.set(definition.key, definition)
    }
  }

  assert<T>(definition: SettingDefinition<T>): void {
    if (this.definitions.get(definition.key) !== definition)
      throw new Error('Unknown setting definition')
  }

  all(): readonly SettingDefinition<unknown>[] {
    return [...this.definitions.values()]
  }
}
