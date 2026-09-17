import { localeParams } from './project-locale-ast-helpers.mjs'
import { projectPrismaLocaleDefault } from './project-locale-prisma-default-operation.mjs'
import { projectSqlLocaleDefault } from './project-locale-sql-default-operation.mjs'

const claim = (location, locale) => ({ location, value: locale })

export const LOCALE_DATABASE_DEFAULT_DEFINITIONS = [
  [
    'locale.prisma-user-default',
    {
      paramsSchema: localeParams,
      claims: ({ locale }) => [claim('prisma:User.locale:default', locale)],
      apply: projectPrismaLocaleDefault,
    },
  ],
  [
    'locale.sql-user-default',
    {
      paramsSchema: localeParams,
      claims: ({ locale }) => [claim('sql:core.users.locale:default', locale)],
      apply: projectSqlLocaleDefault,
    },
  ],
]
