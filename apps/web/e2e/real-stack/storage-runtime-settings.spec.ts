import { expect, test } from '@playwright/test'

import { storageSettingJourney } from '../shared/storage-setting-journey'
import { guardedSql } from '../support/managed-target.mjs'
import {
  blockSettingsReads,
  processObservations,
  settingsProof,
} from '../support/runtime-settings-proof'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test('Overview Edit/Cancel/Save and operator reset in path topology', async ({ page }) => {
  test.setTimeout(180_000)
  settingsProof('start')
  try {
    const email = uniqueEmail('storage-setting-path')
    await registerViaUi(page, email)
    await expect(page).toHaveURL(/\/en\/?$/)
    setSystemRole(email, 'SUPER_ADMIN')
    await page.context().clearCookies()
    await loginViaUi(page, email)
    await expect(page).toHaveURL(/\/en\/?$/)
    await page.goto('/en/admin')
    await storageSettingJourney(page, '/api/console/runtime-settings/storage-probe', async () => {
      await expect
        .poll(
          () =>
            processObservations().map((p) =>
              p.events.some(
                (e) =>
                  e.event === 'runtime_setting_applied' &&
                  e.revision === 1 &&
                  e.intervalSeconds === 60
              )
            ),
          { timeout: 40_000 }
        )
        .toEqual([true, true, true])
    })
    await expect
      .poll(
        () =>
          processObservations().map((p) =>
            p.events.some(
              (e) =>
                e.event === 'runtime_setting_applied' &&
                e.revision === 2 &&
                e.intervalSeconds === 600
            )
          ),
        { timeout: 40_000 }
      )
      .toEqual([true, true, true])
    const observations = processObservations()
    expect(
      observations.map(
        (p) => p.events.find((e) => e.event === 'runtime_setting_applied')?.processRole
      )
    ).toEqual(['web', 'web', 'worker'])
    expect(
      new Set(
        observations.map(
          (p) => p.events.find((e) => e.event === 'runtime_setting_applied')?.instanceId
        )
      ).size
    ).toBe(3)
    for (const p of observations)
      expect(p.events.some((e) => e.revision === 1 && e.intervalSeconds === 60)).toBe(true)
    console.log('Three-process settings evidence:', JSON.stringify(observations))
  } finally {
    settingsProof('stop')
  }
})

test('runtime adoption survives Redis outage, worker restart and real database read failure', async ({
  page,
}) => {
  test.setTimeout(240_000)
  settingsProof('start')
  try {
    const email = uniqueEmail('storage-setting-failures')
    await registerViaUi(page, email)
    await expect(page).toHaveURL(/\/en\/?$/)
    setSystemRole(email, 'SUPER_ADMIN')
    await page.context().clearCookies()
    await loginViaUi(page, email)
    await expect(page).toHaveURL(/\/en\/?$/)
    await page.goto('/en/admin')
    const path = '/api/console/runtime-settings/storage-probe'
    const initial = await page.request.get(path)
    expect(initial.status()).toBe(200)
    const revision = (await initial.json()).saved.revision + 1
    const written = await page.request.patch(path, {
      headers: { Origin: new URL(page.url()).origin },
      data: { intervalSeconds: 90, expectedRevision: revision - 1 },
    })
    expect(written.status()).toBe(200)
    settingsProof('pause-redis')
    const denied = await page.request
      .get(path, { timeout: 3000 })
      .then((r) => r.status())
      .catch(() => 0)
    expect([0, 503]).toContain(denied)
    await expect
      .poll(
        () =>
          processObservations().map((p) =>
            p.events.some(
              (e) =>
                e.event === 'runtime_setting_applied' &&
                e.revision === revision &&
                e.intervalSeconds === 90
            )
          ),
        { timeout: 40_000 }
      )
      .toEqual([true, true, true])
    await expect
      .poll(
        async () =>
          page.request
            .get(path, { timeout: 3000 })
            .then((r) => r.status())
            .catch(() => 0),
        { timeout: 45_000 }
      )
      .toBe(200)
    const oldBoots = processObservations()[2]!
      .events.filter((e) => e.event === 'runtime_setting_applied')
      .map((e) => e.instanceId)
    settingsProof('restart-worker')
    await expect
      .poll(
        () =>
          processObservations()[2]!.events.some(
            (e) =>
              e.event === 'runtime_setting_applied' &&
              e.revision === revision &&
              e.intervalSeconds === 90 &&
              !oldBoots.includes(e.instanceId)
          ),
        { timeout: 40_000 }
      )
      .toBe(true)
    const failures = processObservations().map(
      (p) => p.events.filter((e) => e.event === 'runtime_setting_refresh_failed').length
    )
    const blocked = blockSettingsReads()
    await expect
      .poll(() =>
        Number(
          guardedSql(
            "SELECT count(*) FROM pg_locks WHERE relation = 'core.platform_settings'::regclass AND mode = 'AccessExclusiveLock' AND granted;"
          ).trim()
        )
      )
      .toBe(1)
    const unavailable = await page.request.get(path)
    expect(unavailable.status()).toBe(503)
    await expect(page.getByRole('heading', { name: 'File storage', exact: true })).toBeVisible()
    await expect
      .poll(
        () =>
          processObservations().map(
            (p, i) =>
              p.events.filter((e) => e.event === 'runtime_setting_refresh_failed').length >
              failures[i]!
          ),
        { timeout: 35_000 }
      )
      .toEqual([true, true, true])
    await blocked
    await expect
      .poll(
        () =>
          processObservations().map((p) =>
            p.events.some(
              (e) => e.event === 'runtime_setting_refresh_recovered' && e.revision === revision
            )
          ),
        { timeout: 40_000 }
      )
      .toEqual([true, true, true])
    const recovered = await page.request.get(path)
    expect((await recovered.json()).applied).toMatchObject({
      intervalSeconds: 90,
      revision,
      refreshStatus: 'confirmed',
    })
    console.log('Outage/restart evidence:', JSON.stringify(processObservations()))
  } finally {
    settingsProof('stop')
  }
})
