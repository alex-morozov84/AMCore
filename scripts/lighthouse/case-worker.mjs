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
import {
  assertMeasuredPage,
  watchMeasuredPage,
  measuredErrorKind,
  bfCacheConfig,
} from './page-state.mjs'
import { saveAcceptanceFixture, restoreAcceptance } from './acceptance-controls.mjs'
import { prepareFixture } from './fixture.mjs'
import { probeProof } from './session-probe.mjs'

const [id, output, resultFile, control, acceptanceDirectory] = process.argv.slice(2)
let browser, pw, watch, profile, probeContext
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
    proxy: { server: m.relay },
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
    probeContext = page.context()
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
    await client.send('Page.enable')
    const { frameTree } = await client.send('Page.getFrameTree')
    await client.send('Network.clearBrowserCache')
    await client.send('Network.setBypassServiceWorker', { bypass: true })
    const pending = []
    const navigation = {}
    const verifyPending = async () => {
      const outcomes = await Promise.all(pending).catch(() => [false])
      invariant(outcomes.every(Boolean), 'navigation-identity-refused')
      completeNavigation(navigation)
    }
    const onNavigation = ({ frame }) => {
      if (frame.parentId) return
      let kind
      try {
        kind = admitNavigation(navigation, frame.url + (frame.urlFragment ?? ''), url)
      } catch {
        navigationProof.push({ kind: 'unexpected-navigation' })
        pending.push(Promise.resolve(false))
        return
      }
      if (kind !== 'measured') {
        navigationProof.push({ kind })
        return
      }
      const generation = navigation.measured
      const check = { kind: 'measured', generation, stage: 'capture', passed: false }
      navigationProof.push(check)
      const captured = page
        .waitForURL(url, { waitUntil: 'domcontentloaded', timeout: 10_000 })
        .then(() => page.evaluateHandle(() => globalThis.document))
      pending.push(
        captured
          .then(async (document) => {
            try {
              invariant(generation === navigation.measured, 'navigation-identity-refused')
              const value = await assertMeasuredPage(
                page,
                scenario,
                fixture,
                url,
                Promise.resolve(document),
                check
              )
              check.stage = 'final-document-check'
              invariant(generation === navigation.measured, 'navigation-identity-refused')
              return value
            } catch (error) {
              await document.dispose().catch(() => {})
              throw error
            }
          })
          .then((value) => {
            Object.assign(check, { passed: true, stage: 'complete' })
            return value
          })
          .catch((error) => {
            Object.assign(check, {
              currentGeneration: navigation.measured,
              away: Boolean(navigation.away),
              errorKind: measuredErrorKind(error),
              code: [
                'invalid-measured-identity-or-state',
                'measured-subject-refused',
                'measured-session-cookie-changed',
                'measured-session-fence-missing',
                'measured-credentials-present',
                'measured-state-busy',
                'unexpected-measured-url',
                'console-audience-refused',
                'navigation-identity-refused',
              ].includes(error.message)
                ? error.message
                : 'operation-refused',
            })
            return false
          })
      )
    }
    const onSameDocument = ({ frameId, url: actual }) => {
      if (frameId === frameTree.frame.id && actual !== url) navigation.invalid = true
    }
    client.on('Page.frameNavigated', onNavigation)
    client.on('Page.navigatedWithinDocument', onSameDocument)
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
      bfCacheConfig(verifyPending),
      measured
    )
    client.off('Page.frameNavigated', onNavigation)
    client.off('Page.navigatedWithinDocument', onSameDocument)
    await verifyPending()
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
    if (!control && process.env.AMCORE_AUDIT_ACCEPTANCE === 'true' && id !== 'login')
      await saveAcceptanceFixture(page, fixture, url, output)
    await writeFile(
      resultFile,
      JSON.stringify({
        id,
        valid: true,
        identity: true,
        requiredData: true,
        navigationProof,
        probes: probeProof(probeContext),
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
    'fixture-subject-unproved',
    'fixture-api-login-refused',
    'fixture-api-subject-mismatch',
    'fixture-organization-refused',
    'fixture-api-logout-refused',
    'fixture-organization-missing',
    'negative-subject-registration-refused',
    'negative-subject-logout-refused',
    'negative-subject-unproved',
    'invalid-measured-identity-or-state',
    'measured-subject-refused',
    'measured-session-cookie-changed',
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
    JSON.stringify({
      id,
      valid: false,
      stage,
      reason,
      errorKind: measuredErrorKind(error),
      navigationProof,
      probes: probeProof(probeContext),
    }),
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
