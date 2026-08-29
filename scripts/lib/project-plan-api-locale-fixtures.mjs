// init:project --mode=single: auth.controller.spec.ts and auth.service.spec.ts.
// Found via the real `pnpm --filter web build`/`test` in init-project.test.mjs.
// Most occurrences are an arbitrary sample locale value in a mock fixture, so
// become the kept locale directly. One test's premise ("a supplied locale
// that differs from the stored one gets written") cannot hold once only one
// valid locale value exists — redesigned to drop `locale` from that specific
// assertion, since `name` alone already proves the test's point ("writes the
// supplied fields"); the sibling test proving the opposite case (an unchanged
// `locale` is excluded from the diff) still works unmodified once its 'ru'
// becomes the kept locale, matching the now-single-locale mockUser fixture.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'
import { authServiceUrlTransform } from './project-plan-api-auth-service-url-test.mjs'

const MOCK_USER_BLOCK_BEFORE = `    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2025-01-01'),
`
const MOCK_USER_RESPONSE_BLOCK_BEFORE = `    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: '2025-01-01T00:00:00.000Z',
`

function controllerTransform(locale) {
  return (content) => {
    const next = replaceExactBlock(
      content,
      MOCK_USER_BLOCK_BEFORE,
      `    phone: null,\n    locale: '${locale}',\n    timezone: 'Europe/Moscow',\n    createdAt: new Date('2025-01-01'),\n`
    )
    return replaceExactBlock(
      next,
      MOCK_USER_RESPONSE_BLOCK_BEFORE,
      `    phone: null,\n    locale: '${locale}',\n    timezone: 'Europe/Moscow',\n    createdAt: '2025-01-01T00:00:00.000Z',\n`
    )
  }
}

const MOCK_USER_FIXTURE_BEFORE = `    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2024-01-01'),
`

const ACCEPTED_LOCALE_BEFORE = `        await authService.register(
          { ...registerInput, locale: 'en' },
          { ...requestInfo, acceptedLocale: 'ru' }
        )
`

const WRITES_SUPPLIED_FIELDS_BEFORE = `      const updated = { ...mockUser, name: 'Renamed', locale: 'en' }
      mockCtx.prisma.user.update.mockResolvedValue(updated)

      const result = await authService.updateProfile('user-123', { name: 'Renamed', locale: 'en' })

      expect(mockCtx.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { name: 'Renamed', locale: 'en' },
      })
      expect(mockUserCacheService.invalidateUser).toHaveBeenCalledWith('user-123')
      expect(result).toMatchObject({ name: 'Renamed', locale: 'en' })
`

const WRITES_SUPPLIED_FIELDS_AFTER = `      const updated = { ...mockUser, name: 'Renamed' }
      mockCtx.prisma.user.update.mockResolvedValue(updated)

      const result = await authService.updateProfile('user-123', { name: 'Renamed' })

      expect(mockCtx.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { name: 'Renamed' },
      })
      expect(mockUserCacheService.invalidateUser).toHaveBeenCalledWith('user-123')
      expect(result).toMatchObject({ name: 'Renamed' })
`

const ONLY_CHANGED_FIELDS_BEFORE = `      // \`locale\` is supplied but set to the same value the user already has (\`mockUser.locale\`
      // is 'ru') — only \`name\` genuinely changed.
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, name: 'Renamed' })

      await authService.updateProfile('user-123', { name: 'Renamed', locale: 'ru' })
`

function onlyChangedFieldsAfter(locale) {
  return `      // \`locale\` is supplied but set to the same value the user already has (\`mockUser.locale\`
      // is '${locale}') — only \`name\` genuinely changed.
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, name: 'Renamed' })

      await authService.updateProfile('user-123', { name: 'Renamed', locale: '${locale}' })
`
}

function serviceTransform(locale) {
  return (content) => {
    let next = replaceExactBlock(
      content,
      MOCK_USER_FIXTURE_BEFORE,
      `    phone: null,\n    locale: '${locale}',\n    timezone: 'Europe/Moscow',\n    createdAt: new Date('2024-01-01'),\n`
    )
    next = replaceExactBlock(
      next,
      ACCEPTED_LOCALE_BEFORE,
      `        await authService.register(\n          { ...registerInput, locale: '${locale}' },\n          { ...requestInfo, acceptedLocale: '${locale}' }\n        )\n`
    )
    next = replaceExactBlock(next, WRITES_SUPPLIED_FIELDS_BEFORE, WRITES_SUPPLIED_FIELDS_AFTER)
    next = replaceExactBlock(next, ONLY_CHANGED_FIELDS_BEFORE, onlyChangedFieldsAfter(locale))
    return authServiceUrlTransform(next)
  }
}

export function buildApiLocaleFixturesSteps(root, locale) {
  return [
    fileStep(
      path.join(root, 'apps/api/src/core/auth/auth.controller.spec.ts'),
      controllerTransform(locale),
      `auth.controller.spec.ts: use '${locale}' in the mock user fixtures`
    ),
    fileStep(
      path.join(root, 'apps/api/src/core/auth/auth.service.spec.ts'),
      serviceTransform(locale),
      `auth.service.spec.ts: use '${locale}' throughout, dropping the now-impossible locale-differs case`
    ),
  ]
}
