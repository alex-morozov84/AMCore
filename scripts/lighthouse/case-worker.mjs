import { admitNavigation, completeNavigation } from '../lib/lighthouse-navigation.mjs'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import lighthouse from 'lighthouse'
import { ReportGenerator } from 'lighthouse/report/generator/report-generator.js'
import { activeTarget } from '../../apps/web/e2e/support/managed-target.mjs'
import { auditCatalogue, auditChoices, invariant, digest } from '../lib/lighthouse-plan.mjs'
import { evaluateResult } from '../lib/lighthouse-policy.mjs'
import { writePair } from '../lib/lighthouse-reports.mjs'
import { launchAuditBrowser } from './browser.mjs'
import { assertMeasuredPage, watchMeasuredPage } from './page-state.mjs'
import { saveAcceptanceFixture, restoreAcceptance } from './acceptance-controls.mjs'
import { prepareFixture } from './fixture.mjs'

const [id, output, resultFile, control, acceptanceDirectory] = process.argv.slice(2)
let browser, pw, watch, profile
let stage = 'admission'
const navigationProof = []
try {
  const m = activeTarget()
  const choices = auditChoices(m.snapshot)
  const scenario = auditCatalogue(m.snapshot, choices).scenarios.find((s) => s.id === id)
  invariant(scenario && m.purpose === 'e2e' && !m.mocked, 'unadmitted-audit-case')
  profile = await mkdtemp(join(output, 'profile-'))
  stage = 'browser-launch'
  browser = await launchAuditBrowser(m, profile)
  const require = createRequire(join(m.snapshot, 'apps/web/package.json'))
  const { chromium } = require('@playwright/test')
  stage = 'browser-bridge'
  pw = await chromium.connectOverCDP(browser.wsEndpoint())
  const saved = control
    ? JSON.parse(await readFile(join(acceptanceDirectory, 'fixture.json'), 'utf8'))
    : undefined
  const context = await pw.newContext({
    ...(control && control !== 'sign-in-stall'
      ? { storageState: join(acceptanceDirectory, 'state.json') }
      : {}),
    baseURL: saved ? new URL(saved.url).origin : m.origins.product,
    ignoreHTTPSErrors: m.topology === 'host',
    serviceWorkers: 'block',
  })
  stage = control ? `control-${control}` : 'fixture'
  const prepared = control
    ? await restoreAcceptance(
        context,
        control,
        acceptanceDirectory,
        scenario,
        await import('../../apps/web/e2e/real-stack/helpers.ts')
      )
    : await prepareFixture(context, m, scenario, choices.productAdmin.alias)
  if (prepared.acceptedRefusal) {
    await writeFile(resultFile, JSON.stringify({ control, acceptedRefusal: true }), {
      flag: 'wx',
      mode: 0o600,
    })
  } else {
    const { page, fixture, url } = prepared
    stage = 'page-identity'
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await assertMeasuredPage(page, scenario, fixture, url)
    watch = watchMeasuredPage(page, new URL(url).origin, id === 'login', fixture.subject)
    const pages = await browser.pages()
    const measured = pages.find((p) => p.url() === url)
    invariant(
      measured && pages.filter((p) => p.url() === url).length === 1,
      'ambiguous-measured-page'
    )
    const client = await measured.createCDPSession()
    await client.send('Network.enable')
    await client.send('Network.clearBrowserCache')
    await client.send('Network.setBypassServiceWorker', { bypass: true })
    const pending = []
    const navigation = {}
    const onNavigation = (frame) => {
      if (frame !== page.mainFrame()) return
      let kind
      try {
        kind = admitNavigation(navigation, frame.url(), url)
      } catch {
        navigationProof.push({ kind: 'unexpected-navigation' })
        pending.push(Promise.resolve(false))
        return
      }
      if (kind !== 'measured') {
        navigationProof.push({ kind })
        return
      }
      pending.push(
        page
          .waitForLoadState('domcontentloaded')
          .then(() => assertMeasuredPage(page, scenario, fixture, url))
          .then((value) => {
            navigationProof.push({ kind: 'measured', passed: true })
            return value
          })
          .catch((error) => {
            navigationProof.push({
              kind: 'measured',
              passed: false,
              code: [
                'invalid-measured-identity-or-state',
                'measured-subject-refused',
                'measured-session-fence-missing',
                'measured-credentials-present',
                'measured-state-busy',
                'unexpected-measured-url',
                'console-audience-refused',
              ].includes(error.message)
                ? error.message
                : 'operation-refused',
            })
            return false
          })
      )
    }
    page.on('framenavigated', onNavigation)
    if (control === 'audit-stall' || control === 'expired') {
      await page.route(
        url,
        async (route) => {
          await writeFile(
            join(acceptanceDirectory, `entered-${control}.json`),
            JSON.stringify({ stage: 'audit' }),
            { mode: 0o600 }
          )
          if (control === 'audit-stall') return new Promise(() => {})
          await page.context().clearCookies()
          await route.continue()
        },
        { times: 1 }
      )
    }
    stage = 'lighthouse'
    const response = await lighthouse(
      url,
      {
        output: 'json',
        logLevel: 'silent',
        enableErrorReporting: false,
        disableStorageReset: true,
        disableFullPageScreenshot: true,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
        ...(control === 'audit-stall' ? { maxWaitForLoad: 180_000, maxWaitForFcp: 180_000 } : {}),
      },
      undefined,
      measured
    )
    page.off('framenavigated', onNavigation)
    invariant((await Promise.all(pending)).every(Boolean), 'navigation-identity-refused')
    completeNavigation(navigation)
    const state = await assertMeasuredPage(page, scenario, fixture, url)
    await watch.assert()
    const robots = await page.evaluate(
      async () =>
        (await fetch(globalThis.location.href, { redirect: 'error' })).headers.get(
          'x-robots-tag'
        ) ?? ''
    )
    await watch.assert()
    const observation = {
      ...state,
      indexable: state.indexable && !/noindex/i.test(robots),
      requiredData: true,
      url,
    }
    stage = 'policy-validation'
    const policy = evaluateResult(response?.lhr, scenario, observation)
    const secrets = [
      ...fixture.secrets,
      ...(await page.context().cookies()).map((c) => c.value).filter((v) => v.length >= 12),
    ]
    stage = 'safe-report'
    const files = await writePair(
      output,
      id,
      {
        json: JSON.stringify(response.lhr),
        html: ReportGenerator.generateReport(response.lhr, 'html'),
      },
      secrets
    )
    if (!control && process.env.AMCORE_AUDIT_ACCEPTANCE === 'true' && id === 'members')
      await saveAcceptanceFixture(page, fixture, url, output)
    await writeFile(
      resultFile,
      JSON.stringify({
        id,
        valid: true,
        identity: true,
        requiredData: true,
        navigationProof,
        subject: fixture.subject ? digest(fixture.subject) : 'anonymous',
        policy,
        files,
        browser: await browser.version(),
        profile: response.lhr.configSettings,
      }),
      { flag: 'wx', mode: 0o600 }
    )
  }
} catch (error) {
  // Arbitrary browser/Lighthouse exceptions may contain credentials or setup DOM.
  const known = [
    'invalid-measured-identity-or-state',
    'measured-subject-refused',
    'measured-session-fence-missing',
    'measured-credentials-present',
    'measured-state-busy',
    'unexpected-measured-url',
    'invalid-anonymous-form',
    'auth-setup-page-refused',
    'console-audience-refused',
    'invalid-engine-result',
    'changed-audit-inventory',
    'invalid-category',
    'invalid-audit-score',
    'unknown-or-error-audit-mode',
    'invalid-metric',
    'unverified-measured-state',
    'unsafe-report-content',
    'required-data-429',
    'required-data-refused',
    'navigation-identity-refused',
  ]
  const reason = known.includes(error.message) ? error.message : 'operation-refused'
  await writeFile(
    resultFile,
    JSON.stringify({ id, valid: false, stage, reason, navigationProof }),
    {
      flag: 'wx',
      mode: 0o600,
    }
  ).catch(() => {})
  console.error(JSON.stringify({ id, stage, reason, valid: false, navigationProof }))
  process.exitCode = 1
} finally {
  watch?.close()
  if (pw)
    await pw.close().catch(() => {
      process.exitCode = 1
    })
  if (browser)
    await browser.close().catch(() => {
      process.exitCode = 1
    })
  if (profile) await rm(profile, { recursive: true, force: true })
}
