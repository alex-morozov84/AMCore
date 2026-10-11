import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { sql } from './ownership.mjs'
import { compose } from './docker.mjs'
import { save } from './state.mjs'

const fixtureSql = (m, query, variables = {}) =>
  sql(
    m,
    query,
    Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [
        key,
        typeof value === 'boolean' ? String(value) : value,
      ])
    )
  )

const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}
const cases = [
  'safe',
  'safe_future',
  'safe_repeat',
  'pending',
  'reserved',
  'spent',
  'unknown',
  'permanent',
  'version',
  'target',
  'legacy',
  'old',
  'recent',
  'history',
  'expired',
  'email-unknown',
  'active',
]

/** Only marker-locked fixture SQL writes data. Repeated preview never resets owner actions. */
export async function notificationWorkFixture(m) {
  if (!m.consoleEnabled || m.fixtureProfile !== 'notification-work')
    throw new Error('Wrong notification fixture stand')
  const tag = m.uuid.replaceAll('-', '').slice(0, 8)
  const actor = m.accounts.find((account) => account.role === 'SUPER_ADMIN')?.id
  if (!actor) throw new Error('Notification fixture requires the preview SUPER_ADMIN')
  const record = (m.notificationFixture ??= { version: 1, tag, actor, units: [] })
  if (record.version !== 1 || record.tag !== tag || record.actor !== actor)
    throw new Error('Notification fixture identity changed')
  if (!record.proofs) {
    const program = `
      const {TelegramBotApiClient} = require('./dist/core/notifications/channels/telegram/telegram-bot-api.client.js');
      const client = new TelegramBotApiClient({get:key=>process.env[key]});
      (async()=>{
        const safe=[]; for(const chatId of ['111001','111011','111021']) for(let i=0;i<5;i++) safe.push(await client.sendMessage({chatId,text:'Preview notification'}));
        const unknown=[]; for(let i=0;i<2;i++) unknown.push(await client.sendMessage({chatId:'111003',text:'Preview notification'}));
        const permanent=await client.sendMessage({chatId:'111004',text:'Preview notification'});
        if(safe.some(r=>r.status!=='transient'||r.effectCertainty!=='none')||unknown[1].effectCertainty!=='none') throw new Error('Fake provider witness failed');
        console.log(JSON.stringify({safe,unknown,permanent}));
      })().catch(()=>process.exit(1));`
    record.proofs = JSON.parse(
      await compose(m, ['exec', '-T', 'api', 'node', '-e', program], { capture: true })
    )
    await save(m)
  }
  if (!record.prepared) {
    await fixtureSql(
      m,
      'UPDATE notifications.notification_delivery_control SET paused = true, revision = revision + 1 WHERE id = 1;'
    )
    record.prepared = true
    await save(m)
  }
  for (const name of cases.filter((name) => !record.units.includes(name))) {
    await seed(m, tag, actor, name)
    record.units.push(name)
    await save(m)
  }
  if (!record.complete) {
    record.complete = true
    await save(m)
  }
  console.log(
    `Notification cases: ${cases.map((name) => `t042_${tag}_${name.replaceAll('-', '_')}`).join(', ')}`
  )
  console.log(
    'Notification claims start paused. Fake Telegram is internal; no real messages are sent. Safe case has five actual SDK HTTP429 witnesses; one granted retry can reach fake acceptance.'
  )
}

async function seed(m, tag, actor, name) {
  const id = `t042_${tag}_${name.replaceAll('-', '_')}`
  const recipient = `${id}_recipient`,
    parent = `${id}_event`,
    connection = `${id}_connection`
  const channel = name === 'email-unknown' ? 'email' : 'telegram'
  const chat =
    name === 'safe_future'
      ? '111011'
      : name === 'safe_repeat'
        ? '111021'
        : name === 'safe'
          ? '111001'
          : name === 'pending'
            ? '111002'
            : name === 'unknown'
              ? '111003'
              : name === 'permanent'
                ? '111004'
                : String(111100 + cases.indexOf(name))
  const now = new Date(),
    old = new Date(now.getTime() - 45 * 86400000)
  const pending = ['pending', 'reserved'].includes(name),
    active = name === 'active'
  const count = ['pending', 'old', 'recent'].includes(name)
    ? 0
    : name === 'unknown'
      ? 2
      : name === 'permanent'
        ? 1
        : name === 'history'
          ? 18
          : ['spent', 'expired'].includes(name)
            ? 6
            : 5
  const grant =
    name === 'reserved'
      ? 'reserved'
      : ['spent', 'history', 'expired'].includes(name)
        ? 'spent'
        : 'none'
  const command = randomUUID()
  const request = {
    formatVersion: 1,
    wireVersion: 1,
    deliveryId: id,
    channel,
    type: 'account.password_changed',
    schemaVersion: name === 'version' ? 999 : 1,
    targetKey: chat,
    targetRef: connection,
    binding: `telegram:TELEGRAM_BOT_TOKEN:${hash('http://notification-provider:8099')}`,
    idempotencyKey: null,
    method: 'POST',
    path: 'sendMessage',
    body: JSON.stringify({ chat_id: chat, text: 'Preview notification' }),
  }
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        'telegram',
        null,
        'http://notification-provider:8099',
        createHash('sha256').update('<fake-preview-token>').digest('hex'),
      ])
    )
    .digest('hex')
  const attempts = Array.from(
    { length: Math.max(0, count - (name === 'expired' ? 5 : 0)) },
    (_, index) => {
      const number = index + (name === 'expired' ? 6 : 1)
      const isActive = active && number === count
      const isGrant = grant === 'spent' && number === count
      return {
        number,
        started: now.toISOString(),
        finished: isActive ? null : now.toISOString(),
        outcome: isActive ? null : name === 'permanent' ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE',
        effect: isActive
          ? 'possible'
          : name === 'legacy' || (name === 'unknown' && number === 1)
            ? 'unknown'
            : 'proven_none',
        actor: isGrant ? actor : null,
        command: isGrant ? command : null,
      }
    }
  )
  await fixtureSql(
    m,
    `
    INSERT INTO core.users (id,email,"emailCanonical","emailVerified",locale,timezone,"updatedAt")
      VALUES (:'recipient', :'email', :'email', true, :'locale', 'UTC', clock_timestamp());
    INSERT INTO notifications.notifications (id,"recipientUserId",type,category,"schemaVersion",payload,"idempotencyKey","idempotencyFingerprint","occurredAt","createdAt")
      VALUES (:'parent', :'recipient', 'account.password_changed', 'security', :version, jsonb_build_object('changedAt', :'now'), :'id', :'id', :'now'::timestamp, :'old'::timestamp);
    INSERT INTO notifications.telegram_connections (id,"userId","chatId","telegramUserId",status,"updatedAt")
      VALUES (:'current_connection', :'recipient', :'chat', :'chat', 'ACTIVE', clock_timestamp());
    INSERT INTO notifications.notification_deliveries (id,"notificationId",channel,"targetKey","targetRef",locale,status,"maxAttempts","attemptCount","manualGrant","grantActorId","grantCommandId","grantAttemptNumber","requestContractVersion","preparedRequest","preparedRequestHash","providerScope","retryableExhaustion","unresolvedEffectCount","legacyUnverified","terminalReasonCode","lastErrorCode","terminalAt","nextAttemptAt","availableAt","createdAt","updatedAt","historyPrunedThrough","leaseToken","leaseExpiresAt")
      VALUES (:'id', :'parent', :'channel', :'chat', :'connection', :'locale', :'status'::notifications."NotificationDeliveryStatus", :budget, :count, :'grant', NULLIF(:'actor',''), NULLIF(:'command','')::uuid, NULLIF(:'grant_attempt','')::int,
        1, :'request'::jsonb, NULLIF(:'hash',''), :'scope', :retryable, :unresolved, :legacy, :'terminal_reason', :'error', NULLIF(:'terminal','')::timestamptz,
        NULLIF(:'floor','')::timestamp, clock_timestamp(), :'old'::timestamp, clock_timestamp(), :pruned, NULLIF(:'lease',''), NULLIF(:'lease_expires','')::timestamp);
    INSERT INTO notifications.notification_deliveries (id,"notificationId",channel,"targetKey",locale,status,"maxAttempts","terminalAt","updatedAt")
      VALUES (:'inapp', :'parent', 'in_app', :'recipient', :'locale', 'DELIVERED', 1, clock_timestamp(), clock_timestamp());
    INSERT INTO notifications.notification_delivery_attempts
    (id,"deliveryId","attemptNumber","leaseToken","startedAt","finishedAt",outcome,"errorCode","effectState","grantActorId","grantCommandId")
    SELECT :'id' || '_attempt_' || a.number, :'id', a.number, :'id' || '_lease_' || a.number,
      a.started, a.finished, a.outcome::notifications."NotificationAttemptOutcome",
      'telegram_rate_limited', a.effect, a.actor, a.command
    FROM jsonb_to_recordset(:'attempts'::jsonb) AS a(number int, started timestamp,
      finished timestamp, outcome text, effect text, actor text, command uuid);

  `,
    {
      id,
      attempts: JSON.stringify(attempts),
      parent,
      recipient,
      email: `${id}@preview.amcore.test`,
      current_connection: name === 'target' ? `${connection}_new` : connection,
      connection,
      chat,
      channel,
      locale: m.baseLocale,
      version: name === 'version' ? 999 : 1,
      now: now.toISOString(),
      old: old.toISOString(),
      status: active ? 'PROCESSING' : pending ? 'RETRY_SCHEDULED' : 'FAILED',
      budget: name === 'history' ? 18 : 5,
      count,
      first: name === 'expired' ? 6 : 1,
      active,
      permanent: name === 'permanent',
      unknown: ['unknown', 'legacy', 'email-unknown'].includes(name),
      grant,
      actor: grant !== 'none' ? actor : '',
      command: grant !== 'none' ? command : '',
      grant_attempt: grant === 'spent' ? String(count) : '',
      request: channel === 'email' ? 'null' : JSON.stringify(request),
      hash: channel === 'email' ? '' : hash(request),
      scope,
      retryable: !['permanent', 'old', 'recent', 'active'].includes(name),
      unresolved: ['unknown', 'legacy', 'email-unknown', 'active'].includes(name) ? 1 : 0,
      legacy: name === 'legacy',
      terminal_reason: name === 'permanent' ? 'permanent_failure' : 'attempts_exhausted',
      error:
        channel === 'email'
          ? 'email_provider_transient'
          : name === 'permanent'
            ? 'telegram_blocked'
            : 'telegram_rate_limited',
      terminal: active || pending ? '' : name === 'recent' ? now.toISOString() : old.toISOString(),
      floor:
        name === 'safe_future'
          ? new Date(now.getTime() + 1800000).toISOString()
          : name === 'safe' || name === 'safe_repeat' || pending
            ? new Date(now.getTime() + 120000).toISOString()
            : '',
      pruned: name === 'expired' ? 5 : 0,
      lease: active ? `${id}_lease` : '',
      lease_expires: active ? new Date(now.getTime() + 1800000).toISOString() : '',
      inapp: `${id}_inapp`,
    }
  )
}

/** Read-only browser proof uses the same accessibility helper as repository E2E. */
export async function notificationWorkPreview(page, m, supportedLocales) {
  const requireWeb = createRequire(join(m.worktree, 'apps/web/package.json'))
  const requireApi = createRequire(join(m.worktree, 'apps/api/package.json'))
  const { expect: baseExpect } = requireWeb('@playwright/test')
  const expect = baseExpect.configure({ timeout: 65000 })
  const { require: tsxRequire } = requireApi('tsx/cjs/api')
  const { expectNoAxeViolations } = tsxRequire(
    join(m.worktree, 'apps/web/e2e/shared/axe.ts'),
    import.meta.url
  )
  const locales = m.localePrefix ? supportedLocales : [m.baseLocale]
  const errors = []
  let rateResetAt = 0
  page.on('response', (response) => {
    const reset = Number(response.headers()['x-ratelimit-reset'])
    if (Number.isFinite(reset) && reset > 0)
      rateResetAt = Math.max(rateResetAt, Date.now() + reset * 1000)
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/background-work/works/*/jobs**', async (route) => {
    let response = await route.fetch()
    const recoveryDeadline = Date.now() + 60000
    while (response.status() === 429) {
      const seconds = Number(response.headers()['retry-after'])
      if (
        !Number.isInteger(seconds) ||
        seconds < 1 ||
        seconds > 60 ||
        Date.now() + seconds * 1000 > recoveryDeadline
      )
        break
      console.log(`Notification browser read: observing Retry-After ${seconds}s`)
      await delay(seconds * 1000)
      response = await route.fetch()
    }
    await route.fulfill({ response })
  })
  for (const locale of locales) {
    const messages = JSON.parse(
      await readFile(join(m.worktree, `apps/web/messages/${locale}.json`), 'utf8')
    )
    const t = messages.console.backgroundWork.control
    for (const colorScheme of ['light', 'dark']) {
      // Respect the server's observed quota recovery instead of disabling its limiter.
      const quotaWait = Math.max(0, rateResetAt - Date.now())
      if (quotaWait > 60000) throw new Error('Preview quota recovery exceeds one minute')
      if (quotaWait) await delay(quotaWait)
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await page.setViewportSize({ width: colorScheme === 'dark' ? 390 : 1280, height: 900 })
      const prefix = m.localePrefix ? `/${locale}` : ''
      await page.goto(`${prefix}/${m.consoleSlug}/background-work`)
      const card = page
        .getByRole('article')
        .filter({ has: page.getByText('notification-deliveries', { exact: true }) })
      await expect(card).toBeVisible()
      if (locale === m.baseLocale && colorScheme === 'light') {
        const response = await page.request.get('/api/console/background-work/queues')
        expect(response.ok()).toBe(true)
        const body = await response.json()
        const wake = body.queues.find((queue) => queue.name === 'notifications')
        console.log(
          `Notification wake queue observation: ${JSON.stringify({ status: wake?.status, counts: wake?.counts })}`
        )
      }
      await card.getByRole('button', { name: t.inspectJobs, exact: true }).click()
      const region = page.getByRole('region', {
        name: t.jobsTitle.replace('{work}', 'notification-deliveries'),
      })
      const histories = region
        .locator('details')
        .filter({ has: page.getByText(t.historyTitle, { exact: true }) })
      await expect(histories.first())
        .toBeVisible()
        .catch(async (error) => {
          console.error(
            `Notification preview ${locale}/${colorScheme}: ${await region.innerText()}`
          )
          throw error
        })
      const originalUrl = page.url()
      const search = region.getByRole('textbox', { name: t.searchLabel })
      await search.fill(`t042_${m.notificationFixture.tag}_history`)
      await expect(region.getByRole('checkbox')).toHaveCount(1)
      expect(page.url()).toBe(originalUrl)
      await histories.first().locator(':scope > summary').click()
      await expect(
        region.getByText(t.historyNumber.replace('{number}', '18'), { exact: true })
      ).toBeVisible()
      await expect(region.getByText(t.historyStarted, { exact: false }).first()).toBeVisible()
      await expect(region.getByText(t.historyFinished, { exact: false }).first()).toBeVisible()
      const nested = histories.first().locator('details').first()
      const arrow = nested.locator(':scope > summary > svg')
      await expect
        .poll(() => arrow.evaluate((element) => globalThis.getComputedStyle(element).rotate))
        .toBe('none')
      await nested.locator(':scope > summary').click()
      await expect
        .poll(() => arrow.evaluate((element) => globalThis.getComputedStyle(element).rotate))
        .toBe('180deg')
      await nested.locator(':scope > summary').click()
      await expect
        .poll(() => arrow.evaluate((element) => globalThis.getComputedStyle(element).rotate))
        .toBe('none')
      await region.getByRole('button', { name: t.searchClear }).click()
      await expect(search).toBeFocused()
      await expect(histories).not.toHaveCount(1)
      await histories.first().locator(':scope > summary').click()
      await histories.nth(1).locator(':scope > summary').click()
      await expect(histories.first()).not.toHaveAttribute('open')
      await expect(histories.nth(1)).toHaveAttribute('open', '')
      await histories.nth(1).locator(':scope > summary').click()
      await expect(histories.nth(1).locator(':scope > summary')).toBeFocused()
      await region.getByRole('button', { name: 'telegram', exact: true }).click()
      await expect(histories.first()).toBeVisible()
      await expect(
        region.getByRole('checkbox', {
          name: `t042_${m.notificationFixture.tag}_email_unknown`,
          exact: true,
        })
      ).toHaveCount(0)
      await region.getByRole('button', { name: t.allFilter, exact: true }).click()
      await expect(histories.first())
        .toBeVisible()
        .catch(async (error) => {
          console.error(
            `Notification filter reset ${locale}/${colorScheme}: ${await region.innerText()}`
          )
          throw error
        })
      if (colorScheme === 'light') {
        await region.getByRole('button', { name: t.jobStates.prioritized, exact: true }).click()
        await expect(region.getByText(t.noJobs, { exact: true })).toBeVisible()
        await region.getByRole('button', { name: t.jobStates.failed, exact: true }).click()
        await expect(histories.first()).toBeVisible()
        await search.fill(`t042_${m.notificationFixture.tag}_target`)
        await expect(region.getByRole('checkbox')).toHaveCount(1)
        await region.getByRole('checkbox').check()
        await region
          .getByRole('button', { name: `${t.actions.cleanup}${t.separator}1`, exact: true })
          .click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByText(t.projectionNo, { exact: true })).toBeVisible()
        const technical = dialog
          .locator('details')
          .filter({ has: page.getByText(t.technicalDetails, { exact: true }) })
        for (const details of await technical.all()) {
          await details.locator(':scope > summary').click()
          const values = details.locator(':scope > div dd, :scope > div > p')
          expect(await values.count()).toBeGreaterThan(0)
          for (const value of await values.all()) {
            await value.scrollIntoViewIfNeeded()
            await expect(value).toBeInViewport()
            expect((await value.innerText()).trim().length).toBeGreaterThan(0)
          }
        }
        await dialog.screenshot({
          path: `${m.worktree}/.amcore/stands/${m.id}/notification-modal-${locale}.png`,
        })
        await expectNoAxeViolations(page)
        await dialog.getByRole('button', { name: messages.common.cancel, exact: true }).click()
        await region.getByRole('button', { name: t.searchClear }).click()
        await expect(histories).not.toHaveCount(1)
      }
      await expectNoAxeViolations(page)
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth
        )
      ).toBe(true)
      await page.screenshot({
        path: `${m.worktree}/.amcore/stands/${m.id}/notification-${locale}-${colorScheme}.png`,
        fullPage: true,
      })
    }
  }
  expect(errors).toEqual([])
  await page.unroute('**/background-work/works/*/jobs**')
  m.notificationFixture.browserProof = {
    sourceHash: m.sourceHash,
    locales,
    themes: ['light', 'dark'],
    narrowWidth: 390,
    checkedAt: new Date().toISOString(),
  }
  await save(m)
  console.log(
    'Notification browser proof: localized list, one open history, focus, narrow layout and accessibility passed.'
  )
}
