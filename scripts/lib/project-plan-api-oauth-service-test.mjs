// init:project --mode=single: oauth.service.spec.ts. Found via the real
// `pnpm --filter web build`/`test` in init-project.test.mjs. Two tests
// deliberately set the OAuth-state locale and the stored user's locale to
// *different* values, to prove the browser hint never overwrites the
// stored preference — impossible to express once only one valid locale
// value exists. Redesigned under the single-locale invariant: both sides
// become the kept locale, which still exercises the real assertion ("the
// update call never includes a locale key"), just without the now-moot
// differs-from-stored angle.
import path from 'node:path'
import { fileStep, replaceAllExactText, replaceExactBlock } from './init-engine.mjs'

const FACTORY_DEFAULT_BEFORE = `    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    systemRole: 'USER' as never,
`

const RETAINS_STORED_LOCALE_BEFORE = `        browserNonceHash: TEST_NONCE_HASH,
        locale: 'en',
      } as OAuthStateData)
      const user = mockUser({ locale: 'ru' })
`

const DOES_NOT_OVERWRITE_BEFORE = `        browserNonceHash: TEST_NONCE_HASH,
        locale: 'en',
      } as OAuthStateData)
      const existing = mockUser({ locale: 'ru' })
`

function transform(locale) {
  return (content) => {
    let next = replaceExactBlock(
      content,
      FACTORY_DEFAULT_BEFORE,
      `    phone: null,\n    locale: '${locale}',\n    timezone: 'Europe/Moscow',\n    systemRole: 'USER' as never,\n`
    )
    next = replaceExactBlock(
      next,
      RETAINS_STORED_LOCALE_BEFORE,
      `        browserNonceHash: TEST_NONCE_HASH,\n        locale: '${locale}',\n      } as OAuthStateData)\n      const user = mockUser({ locale: '${locale}' })\n`
    )
    next = replaceExactBlock(
      next,
      DOES_NOT_OVERWRITE_BEFORE,
      `        browserNonceHash: TEST_NONCE_HASH,\n        locale: '${locale}',\n      } as OAuthStateData)\n      const existing = mockUser({ locale: '${locale}' })\n`
    )
    // Every other `locale: 'en'` in this file (state fixtures unrelated to the
    // two differs-from-stored scenarios above) is an arbitrary sample value
    // that just needs to stay a valid locale.
    next = replaceAllExactText(next, "locale: 'en',", `locale: '${locale}',`)
    next = replaceAllExactText(next, "locale: 'en' }", `locale: '${locale}' }`)
    return replaceExactBlock(
      next,
      "await service.getAuthorizationURL('google', 'en')",
      `await service.getAuthorizationURL('google', '${locale}')`
    )
  }
}

export function buildApiOauthServiceTestSteps(root, locale) {
  return [
    fileStep(
      path.join(root, 'apps/api/src/core/auth/oauth/oauth.service.spec.ts'),
      transform(locale),
      `oauth.service.spec.ts: use '${locale}' throughout, dropping the now-impossible locale-differs cases`
    ),
  ]
}
