import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PathAlgebraConflictError } from './path-algebra-errors.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const paths = {
  invite: 'apps/api/src/core/organizations/invite.service.spec.ts',
  feed: 'apps/api/src/core/notifications/notification-feed.service.spec.ts',
}

function source(name) {
  return readFileSync(path.join(process.cwd(), paths[name]), 'utf8')
}

function apply(text, name, locale) {
  const operation =
    name === 'invite'
      ? ['locale.api-link-fixture', { locale, variant: 'invite' }]
      : ['locale.notification-feed-test', { locale }]
  const registry = createProjectStructuralRegistry()
  const [operationKey, params] = operation
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: paths[name],
      operationKey,
      params,
    },
  ])
  return applyStructuralPlan(registry, plan, text)
}

test('projects both default-locale expectations to concrete Russian results', () => {
  const invite = apply(source('invite'), 'invite', 'ru')
  const feed = apply(source('feed'), 'feed', 'ru')
  assert.match(invite, /expect\(data\.locale\)\.toBe\('ru'\)/)
  assert.match(invite, /falls back to the base locale/)
  assert.match(feed, /mockResolvedValue\(\{ locale: 'ru' \} as never\)/)
  assert.match(feed, /title: 'Профиль обновлён'/)
  assert.doesNotMatch(feed, /locale: 'en' \} as never/)
})

test('keeps EN projection bytes and expectations unchanged', () => {
  const feed = source('feed')
  assert.equal(apply(feed, 'feed', 'en'), feed)
  assert.match(apply(source('invite'), 'invite', 'en'), /expect\(data\.locale\)\.toBe\('en'\)/)
})

test('preserves pagination, identity, read state, and invite scenario assertions', () => {
  const invite = apply(source('invite'), 'invite', 'ru')
  const feed = apply(source('feed'), 'feed', 'ru')
  assert.match(invite, /expect\(data\.hasAccount\)\.toBe\(false\)/)
  assert.match(invite, /newperson@example\.com/)
  assert.match(feed, /expect\(result\.hasMore\)\.toBe\(false\)/)
  assert.match(feed, /id: 'n1'/)
  assert.match(feed, /type: 'account\.profile_updated'/)
  assert.match(feed, /readAt: null/)
})

test('fails closed for missing and duplicated semantic anchors', () => {
  const inviteTitle = 'sends an org invite email with hasAccount=false for an unknown email'
  const feedTitle = 'renders items in the recipient locale and reports no more when within limit'
  assert.throws(() => apply(source('invite').replace(inviteTitle, 'drifted'), 'invite', 'ru'), seam)
  assert.throws(
    () => apply(`${source('invite')}\nit('${inviteTitle}', () => {})\n`, 'invite', 'ru'),
    seam
  )
  assert.throws(() => apply(source('feed').replace(feedTitle, 'drifted'), 'feed', 'ru'), seam)
  assert.throws(() => apply(`${source('feed')}\nbeforeEach(() => {})\n`, 'feed', 'ru'), seam)
})

function seam(error) {
  return error instanceof PathAlgebraConflictError
}
