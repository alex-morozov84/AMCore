import type { ConfigModuleOptions } from '@nestjs/config'

import { validate } from '../env'

export const envConfigOptions: ConfigModuleOptions = {
  isGlobal: true,
  envFilePath: '../../.env',
  validate,
  // A value normalized to undefined must not fall back to the raw environment.
  skipProcessEnv: true,
}
