import { computeExecutablePath, Browser } from '@puppeteer/browsers'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { browserCache, browserVersion } from './browser.mjs'
import { browserSandboxProfile } from './browser-sandbox.mjs'
import { invariant } from '../lib/lighthouse-plan.mjs'

invariant(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true', 'ci-linux-only')
const executablePath = computeExecutablePath({
  cacheDir: browserCache,
  browser: Browser.CHROME,
  buildId: browserVersion,
  platform: 'linux',
})
const directory = await mkdtemp(join(tmpdir(), 'amcore-browser-preflight-'))
async function smoke() {
  const browser = await puppeteer.launch({ executablePath, headless: true, timeout: 20_000 })
  try {
    invariant((await browser.version()) === `Chrome/${browserVersion}`, 'browser-version-mismatch')
    const page = await browser.newPage()
    await page.goto('chrome://sandbox')
    const state = await page.locator('body').evaluate((body) => body.innerText)
    invariant(/Namespace Sandbox\s+Yes/.test(state), 'namespace-sandbox-not-active')
    invariant(/Seccomp-BPF sandbox\s+Yes/.test(state), 'seccomp-sandbox-not-active')
    console.log(`Pinned Chrome ${browserVersion}: namespace and seccomp sandboxes active`)
  } finally {
    await browser.close()
  }
}
try {
  try {
    await smoke()
  } catch (error) {
    // No site, fixture, credentials or relay exists during this preparation check.
    invariant(/No usable sandbox!/.test(error.message), 'browser-preflight-refused')
    invariant(
      (await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim() ===
        '1',
      'browser-sandbox-prerequisite-unknown'
    )
    console.log('Chrome reported No usable sandbox; allow only the pinned executable in AppArmor')
    const profile = join(directory, 'apparmor-profile')
    await writeFile(profile, browserSandboxProfile(executablePath), { mode: 0o600 })
    execFileSync('sudo', ['-n', 'apparmor_parser', '-r', profile], {
      stdio: 'inherit',
      timeout: 10_000,
    })
    await smoke()
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
