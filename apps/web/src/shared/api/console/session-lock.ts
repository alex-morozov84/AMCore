import { createRedisVaultLock } from '@/shared/api/bff/session-lock-factory'

import 'server-only'

export const redisConsoleVaultLock = createRedisVaultLock('web:console-session:v1')
