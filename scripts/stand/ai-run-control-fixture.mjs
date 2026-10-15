import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sql } from './ownership.mjs'
import { save } from './state.mjs'

const cases = ['queued', 'retryable', 'permanent', 'old_cancelled', 'recent_cancelled']

/** Managed preview writes use the admitted stand marker and preserve later owner edits. */
export async function aiRunControlFixture(m, api) {
  if (!m.consoleEnabled || m.fixtureProfile !== 'ai-run-control')
    throw new Error('Wrong AI run control fixture stand')
  const owner = m.accounts.find((account) => account.role === 'USER')
  if (!owner?.id) throw new Error('AI fixture requires the preview USER')
  const record = (m.aiRunFixture ??= { version: 1, ownerId: owner.id, units: {} })
  if (record.version !== 1 || record.ownerId !== owner.id)
    throw new Error('AI fixture identity changed')
  if (!record.prepared) {
    await sql(
      m,
      'UPDATE ai.ai_run_control SET paused = true, revision = revision + 1 WHERE id = 1;'
    )
    record.prepared = true
    await save(m)
  }
  if (!record.assistantId) {
    const slug = `t043-${m.uuid}`
    await sql(
      m,
      `INSERT INTO ai.ai_assistants
      (id, slug, version, "displayName", enabled, "modelSelection", "allowedModalities",
       "toolAllowlist", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, :'slug', 1, 'AI control preview', true,
        '{"modelSlug":"mock-default"}'::jsonb, ARRAY['text'], ARRAY[]::text[],
        clock_timestamp(), clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ai.ai_assistants WHERE slug = :'slug' AND version = 1);`,
      { slug }
    )
    record.assistantId = (
      await sql(m, "SELECT id FROM ai.ai_assistants WHERE slug = :'slug' AND version = 1;", {
        slug,
      })
    ).trim()
    await save(m)
  }
  const login = await api.post('/api/v1/auth/login', {
    data: { email: owner.email, password: owner.password },
  })
  if (!login.ok()) throw new Error(`AI fixture owner login failed (${login.status()})`)
  const token = (await login.json()).accessToken
  if (!token) throw new Error('AI fixture owner token missing')
  const headers = { Authorization: `Bearer ${token}` }
  for (const name of cases) await seedCase(m, api, record, name, headers)
  console.log(
    `AI run control cases: ${cases.map((name) => `${name}=${record.units[name].runId}`).join(', ')}`
  )
  console.log('AI claims start paused. The mock model is the only provider used by this fixture.')
}

async function seedCase(m, api, record, name, headers) {
  const unit = (record.units[name] ??= {})
  if (!unit.conversationId) {
    const response = await api.post('/api/v1/ai/conversations', {
      headers,
      data: { title: `AI control preview: ${name}`, assistantId: record.assistantId },
    })
    if (response.status() !== 201)
      throw new Error(`AI fixture conversation ${name} failed (${response.status()})`)
    unit.conversationId = (await response.json()).id
    await save(m)
  }
  if (!unit.runId) {
    const response = await api.post('/api/v1/ai/runs', {
      headers,
      data: {
        conversationId: unit.conversationId,
        inputParts: [{ type: 'text', text: `Preview text for ${name}` }],
        idempotencyKey: `t043-${m.uuid}-${name}`,
      },
    })
    if (response.status() !== 201)
      throw new Error(`AI fixture run ${name} failed (${response.status()})`)
    unit.runId = (await response.json()).id
    await save(m)
  }
  if (unit.staged || name === 'queued') {
    unit.staged = true
    await save(m)
    return
  }
  if (name.endsWith('cancelled')) {
    const response = await api.post(`/api/v1/ai/runs/${unit.runId}/cancel`, { headers })
    if (!response.ok()) throw new Error(`AI fixture cancellation failed (${response.status()})`)
    if (name === 'old_cancelled')
      await sql(
        m,
        `UPDATE ai.ai_runs SET "finishedAt" = clock_timestamp() - interval '31 days'
        WHERE id = :'run_id' AND status = 'CANCELLED';`,
        { run_id: unit.runId }
      )
  } else if (name === 'retryable') {
    await sql(
      m,
      `UPDATE ai.ai_runs SET status = 'FAILED', "terminalReasonCode" = 'attempts_exhausted',
      "errorCode" = 'provider_timeout', "attemptCount" = 3, "maxAttempts" = 3,
      "leaseEpoch" = 3, "finishedAt" = clock_timestamp() WHERE id = :'run_id' AND status = 'QUEUED';
      INSERT INTO ai.ai_run_attempts (id, "runId", epoch, outcome, "errorCode", "endedAt")
      SELECT gen_random_uuid()::text, :'run_id', epoch, 'RETRY_SCHEDULED',
        'provider_timeout', clock_timestamp() FROM generate_series(1, 2) AS epoch;
      INSERT INTO ai.ai_run_attempts (id, "runId", epoch, outcome, "errorCode", "endedAt")
      VALUES (gen_random_uuid()::text, :'run_id', 3, 'FAILED', 'provider_timeout', clock_timestamp());`,
      { run_id: unit.runId }
    )
  } else {
    await sql(
      m,
      `UPDATE ai.ai_runs SET status = 'FAILED', "terminalReasonCode" = 'guardrail_refusal',
      "errorCode" = 'input_guard_blocked', "finishedAt" = clock_timestamp()
      WHERE id = :'run_id' AND status = 'QUEUED';`,
      { run_id: unit.runId }
    )
  }
  unit.staged = true
  await save(m)
}

/** The managed browser proves the card, details, locales, and loaded accessibility. */
export async function aiRunControlPreview(page, m) {
  const requireWeb = createRequire(join(m.worktree, 'apps/web/package.json'))
  const requireApi = createRequire(join(m.worktree, 'apps/api/package.json'))
  const { expect: baseExpect } = requireWeb('@playwright/test')
  const expect = baseExpect.configure({ timeout: 45000 })
  const { require: tsxRequire } = requireApi('tsx/cjs/api')
  const { expectNoAxeViolations } = tsxRequire(
    join(m.worktree, 'apps/web/e2e/shared/axe.ts'),
    import.meta.url
  )
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const locale of m.localePrefix ? ['en', 'ru'] : [m.baseLocale]) {
    const messages = JSON.parse(
      await readFile(join(m.worktree, `apps/web/messages/${locale}.json`), 'utf8')
    )
    const prefix = m.localePrefix ? `/${locale}` : ''
    const origin = m.origins.console ?? m.origins.product
    const path = m.origins.console
      ? `${prefix}/background-work`
      : `${prefix}/${m.consoleSlug}/background-work`
    await page.setViewportSize({ width: locale === 'ru' ? 390 : 1280, height: 900 })
    await page.goto(`${origin}${path}`)
    const card = page.getByRole('article').filter({
      has: page.getByText('ai-run-executions', { exact: true }),
    })
    await expect(card).toBeVisible()
    await card
      .getByRole('button', {
        name: messages.console.backgroundWork.control.inspectJobs,
      })
      .click()
    await expect(
      page.getByText(m.aiRunFixture.units.retryable.runId, { exact: true }).first()
    ).toBeVisible()
    await expectNoAxeViolations(page)
    await page.screenshot({
      path: `${m.worktree}/.amcore/stands/${m.id}/preview-ai-run-control-${locale}.png`,
    })
  }
  expect(errors).toEqual([])
}
