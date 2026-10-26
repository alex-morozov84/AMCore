import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'

const web = resolve(import.meta.dirname, '../../apps/web')
const require = createRequire(`${web}/package.json`)
const { ESLint } = require('eslint')
const eslint = new ESLint({ cwd: web })

async function diagnostics(code, file = 'src/features/example/ui/Example.tsx') {
  const [result] = await eslint.lintText(code, { filePath: `${web}/${file}` })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax')
}

test('runtime message imports and provider bypasses fail with occurrence diagnostics', async () => {
  const cases = [
    "import { NextIntlClientProvider as Provider } from 'next-intl'",
    "import { IntlProvider as Provider } from 'use-intl'",
    "import { useMessages as read } from 'use-intl/react'",
    "import * as intl from 'next-intl'; intl.useMessages()",
    "export { IntlProvider as Provider } from 'use-intl/react'",
    "export * from 'next-intl'",
    "const intl = import('use-intl/react')",
    'const intl = import(`next-intl`)',
    "const intl = require('next-intl')",
    'const intl = require(`use-intl`)',
    "import { ClientMessageProvider } from '@/i18n/client-message-provider'",
    "export { getClientMessages } from '@/i18n/client-messages'",
    "import data from '../../../../messages/en.json'",
    "export { default as data } from '../../../../messages/en.json'",
    "export * from '../../../../messages/en.json'",
    "const data = import('../../../../messages/en.json')",
    'const data = import(`../../../../messages/${locale}.json`)',
    "const data = require('../../../../messages/en.json')",
  ]
  for (const code of cases) {
    const found = await diagnostics(code)
    assert(found.length > 0, code)
    assert(
      found.every((message) => message.line > 0),
      code
    )
  }
})

test('runtime universal modules are guarded while types and explicit fixtures are allowed', async () => {
  const code = "import { IntlProvider } from 'use-intl'"
  assert((await diagnostics(code, 'src/shared/lib/example.mts')).length > 0)
  for (const file of ['src/example.test.tsx', 'src/example.stories.tsx', 'src/test/example.tsx']) {
    assert.equal((await diagnostics(code, file)).length, 0, file)
  }
  for (const code of [
    "import type { IntlProvider } from 'use-intl'",
    "import { type IntlProvider } from 'use-intl'",
    "import type data from '../../messages/en.json'",
    "import { type Something } from '@/i18n/client-messages'",
    "export type { IntlProvider } from 'use-intl/react'",
    "import { useLocale, useTranslations } from 'next-intl'",
  ])
    assert.equal((await diagnostics(code)).length, 0, code)
})

test('only exact boundary implementations and request loader receive their own exception', async () => {
  const provider = "import { NextIntlClientProvider } from 'next-intl'"
  const catalogue = "const data = import('../../messages/en.json')"
  assert.equal((await diagnostics(provider, 'src/i18n/client-message-provider.tsx')).length, 0)
  assert.equal((await diagnostics(catalogue, 'src/i18n/request.ts')).length, 0)
  assert((await diagnostics(provider, 'src/i18n/request.ts')).length > 0)
  assert((await diagnostics(catalogue, 'src/i18n/client-message-provider.tsx')).length > 0)
  assert((await diagnostics(provider, 'src/i18n/new-provider.tsx')).length > 0)
})
