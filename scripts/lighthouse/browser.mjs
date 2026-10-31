import { computeExecutablePath, detectBrowserPlatform, Browser } from '@puppeteer/browsers'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { digest, invariant } from '../lib/lighthouse-plan.mjs'

export const browserVersion = '156.0.8078.47'
export const browserCache = join(homedir(), '.cache/puppeteer')
export async function launchAuditBrowser(m, directory) {
  const platform = detectBrowserPlatform()
  const pins = JSON.parse(await readFile(new URL('./browser-pins.json', import.meta.url), 'utf8'))
  invariant(
    pins.version === browserVersion && /^[a-f0-9]{64}$/.test(pins.platforms[platform] ?? ''),
    'browser-platform-not-admitted'
  )
  const executablePath = computeExecutablePath({
    cacheDir: browserCache,
    browser: Browser.CHROME,
    buildId: browserVersion,
    platform,
  })
  invariant(
    digest(await readFile(executablePath)) === pins.platforms[platform],
    'browser-binary-hash-mismatch'
  )
  const browser = await puppeteer.launch({
    executablePath,
    userDataDir: directory,
    headless: true,
    acceptInsecureCerts: m.topology === 'host',
    defaultViewport: null,
    timeout: 20_000,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [`--proxy-server=${m.relay}`, '--proxy-bypass-list=<-loopback>'],
  })
  invariant((await browser.version()) === `Chrome/${browserVersion}`, 'browser-version-mismatch')
  return browser
}
