import { createRedisVaultStore } from './session-vault-store-factory'

import 'server-only'

export const redisVaultStore = createRedisVaultStore('web:session:v1')
