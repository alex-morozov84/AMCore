import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const path = 'apps/web/src/app/[locale]/(auth)/forgot-password/page.tsx'

function apply(source = readFileSync(path, 'utf8')) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path,
      operationKey: 'locale.auth-page',
      params: { locale: 'en' },
    },
  ])
  return applyStructuralPlan(registry, plan, source)
}

test('auth page removes an otherwise empty route parameter completely', () => {
  const output = apply()
  assert.match(output, /function ForgotPassword\(\)/)
  assert.doesNotMatch(output, /\{\}: \{\}/)
})

test('auth page preserves route properties unrelated to locale', () => {
  const source = readFileSync(path, 'utf8')
    .replace('{ params }', '{ params, searchParams }')
    .replace(
      '{ params: Promise<{ locale: string }> }',
      '{ params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }'
    )
    .replace(
      '  const locale = await resolveLocaleParam(params)',
      '  const locale = await resolveLocaleParam(params)\n  await searchParams'
    )
  const output = apply(source)
  assert.match(output, /\{ searchParams \}/)
  assert.match(output, /searchParams: Promise<\{ token\?: string \}>/)
  assert.match(output, /await searchParams/)
  assert.doesNotMatch(output, /params: Promise<\{ locale: string \}>/)
})
