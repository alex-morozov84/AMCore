import { createRedisVaultStore } from '@/shared/api/bff/session-vault-store-factory'

import 'server-only'

export const redisConsoleVaultStore = createRedisVaultStore('web:console-session:v1')
