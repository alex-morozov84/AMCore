import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'

function project(path, operationKey, text = readFileSync(path, 'utf8')) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path,
      operationKey,
      params: { locale: 'ru' },
    },
  ])
  return applyStructuralPlan(registry, plan, text)
}

const consentStory = 'apps/web/src/features/invitation-acceptance/ui/invitation-consent.stories.tsx'
for (const locale of ['en', 'ru']) {
  test(`single ${locale} retains catalogue-bound consent plays with Storybook enabled`, () => {
    const plan = buildProjectFactPlan(process.cwd(), { mode: 'single', locale }, 'admin')
    const step = plan.localeSteps.find((item) => item.target === `${process.cwd()}/${consentStory}`)
    assert.equal(step?.kind, 'edit')
    assert.match(step.after, new RegExp(`/messages/${locale}\\.json`))
    assert.equal((step.after.match(/name: messages.invitationRecipient.accept/g) ?? []).length, 2)
    assert.equal((step.after.match(/name: messages.invitationRecipient.recover/g) ?? []).length, 1)
    assert.match(step.after, /args.onAccept\).toHaveBeenCalledOnce/)
    assert.match(step.after, /args.onRecover\).toHaveBeenCalledOnce/)
    assert.match(step.after, /toBeDisabled/)
    assert.doesNotMatch(step.after, /name: 'Accept invitation'|name: 'Check result'/)
  })
  test(`single ${locale} Storybookoff deletes consent story without a competing edit`, () => {
    const plan = buildProjectFactPlan(process.cwd(), { mode: 'single', locale, storybook: 'disabled' }, 'admin')
    const steps = [...plan.localeSteps, ...plan.sharedContentSteps, ...plan.storybookSteps]
      .filter((item) => item.target === `${process.cwd()}/${consentStory}`)
    assert.deepEqual(steps.map((item) => item.kind), ['delete'])
    assert.ok(plan.storybookSteps.some((item) =>
      item.kind === 'delete' && item.target === `${process.cwd()}/apps/web/.storybook`
    ))
  })
}

const base = 'apps/web/src/app/[locale]/(auth)/invite/'
for (const [route, retained] of [
  ['accept/route.ts', /invitationHandlers.ingress\(request, DEFAULT_LOCALE\)/],
  [
    'bootstrap/[pendingId]/route.ts',
    /invitationHandlers.bootstrap\(request, DEFAULT_LOCALE, pendingId\)/,
  ],
  ['flow/[flowId]/page.tsx', /InvitationRecipientMount flowId=\{flowId\}/],
  ['unusable/page.tsx', /InvitationUnusableMount unavailable=\{query.reason === 'unavailable'\}/],
]) {
  test(`single locale keeps invitation authority and nonlocale inputs: ${route}`, () => {
    const output = project(base + route, 'locale.invitation-route')
    assert.match(output, retained)
    assert.doesNotMatch(output, /resolveLocaleParam|setRequestLocale|locale: string/)
    if (route.includes('flow/')) assert.match(output, /flowId: string/)
    if (route.includes('bootstrap/')) assert.match(output, /pendingId: string/)
    if (route.endsWith('route.ts')) assert.match(output,
      /^import \{ DEFAULT_LOCALE \} from '@amcore\/shared'\n\nimport \{ invitationHandlers \}/)
    if (route.includes('unusable/')) assert.doesNotMatch(output, /params:/)
  })
}

test('invitation route projection fails closed for missing and ambiguous resolution', () => {
  const path = base + 'flow/[flowId]/page.tsx'
  const source = readFileSync(path, 'utf8')
  assert.throws(() =>
    project(
      path,
      'locale.invitation-route',
      source.replace('resolveLocaleParam(params)', 'resolveChanged(params)')
    )
  )
  assert.throws(() =>
    project(
      path,
      'locale.invitation-route',
      source.replace('params])', 'resolveLocaleParam(params)])')
    )
  )
})

for (const feature of ['auth-login', 'auth-register']) {
  test(`single locale retains invited adapter guards and completion: ${feature}`, () => {
    const path = `apps/web/src/features/${feature}/model/use-${feature.slice(5)}.ts`
    const output = project(path, 'locale.navigation-call')
    assert.match(output, /adapter.isCurrent/)
    assert.match(output, /adapter.onSuccess/)
    assert.match(output, /router.push\('\/'\)/)
    assert.doesNotMatch(output, /locale: response.user.locale/)
  })
}
