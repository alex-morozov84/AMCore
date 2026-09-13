import { createRedisVaultLock } from './session-lock-factory'

import 'server-only'

export const redisVaultLock = createRedisVaultLock('web:session:v1')
