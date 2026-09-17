import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { projectPrismaLocaleDefault } from './project-locale-prisma-default-operation.mjs'
import { projectSqlLocaleDefault } from './project-locale-sql-default-operation.mjs'

const root = process.cwd()
const prismaPath = 'apps/api/prisma/user.prisma'
const sqlPath =
  'apps/api/prisma/migrations/20260801103725_default_locale_en_timezone_utc/migration.sql'
const prisma = readFileSync(path.join(root, prismaPath), 'utf8')
const sql = readFileSync(path.join(root, sqlPath), 'utf8')

test('projects one Prisma and SQL default while EN stays byte-identical', () => {
  assert.equal(projectPrismaLocaleDefault(prisma, { locale: 'en' }), prisma)
  assert.equal(projectSqlLocaleDefault(sql, { locale: 'en' }), sql)
  const projectedPrisma = projectPrismaLocaleDefault(prisma, { locale: 'ru' })
  const projectedSql = projectSqlLocaleDefault(sql, { locale: 'ru' })
  assert.match(projectedPrisma, /locale\s+String\s+@default\("ru"\)/)
  assert.match(projectedPrisma, /Selected RU starter defaults/)
  assert.match(projectedSql, /ALTER COLUMN "locale" SET DEFAULT 'ru'/)
  assert.match(projectedSql, /single-locale fork uses Russian as its base locale/)
  assert.match(projectedPrisma, /timezone\s+String\s+@default\("UTC"\)/)
  assert.match(projectedSql, /"timezone" SET DEFAULT 'UTC'/)
})

test('missing or duplicated Prisma and SQL anchors fail closed', () => {
  const prismaField = 'locale           String  @default("en")'
  const sqlDefault = `ALTER COLUMN "locale" SET DEFAULT 'en'`
  assert.throws(() => projectPrismaLocaleDefault(prisma.replace(prismaField, ''), { locale: 'ru' }))
  assert.throws(() =>
    projectPrismaLocaleDefault(
      prisma.replace('timezone         String', `${prismaField}\n  timezone         String`),
      { locale: 'ru' }
    )
  )
  assert.throws(() => projectSqlLocaleDefault(sql.replace(sqlDefault, ''), { locale: 'ru' }))
  assert.throws(() => projectSqlLocaleDefault(`${sql}\n${sqlDefault};\n`, { locale: 'ru' }))
})

test('registered text operations reject unsupported locale params', () => {
  assert.throws(() =>
    materializeProjectContentPath(root, prismaPath, [
      {
        kind: 'content',
        dimension: 'locale',
        path: prismaPath,
        operationKey: 'locale.prisma-user-default',
        params: { locale: 'de' },
      },
    ])
  )
})
