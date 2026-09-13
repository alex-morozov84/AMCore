import { createRedisVaultStore } from '@/shared/api/bff/session-vault-store-factory'

import type { ConsoleVaultRecord } from './session-vault.types'

import 'server-only'

export const redisConsoleVaultStore =
  createRedisVaultStore<ConsoleVaultRecord>('web:console-session:v1')
