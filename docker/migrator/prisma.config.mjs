import base from './prisma.base.config.ts'
import { migrationConnectionUrl } from './connection-options.mjs'

export default {
  ...base,
  datasource: { ...base.datasource, url: migrationConnectionUrl(base.datasource.url) },
}
