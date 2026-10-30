import { install, computeExecutablePath, detectBrowserPlatform, Browser } from '@puppeteer/browsers'
import { readFile, access } from 'node:fs/promises'
import { browserVersion, browserCache } from './browser.mjs'
import { digest, invariant } from '../lib/lighthouse-plan.mjs'

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
if (
  !(await access(executablePath).then(
    () => true,
    () => false
  ))
)
  await install({
    browser: Browser.CHROME,
    buildId: browserVersion,
    platform,
    cacheDir: browserCache,
  })
invariant(
  digest(await readFile(executablePath)) === pins.platforms[platform],
  'browser-binary-hash-mismatch'
)
console.log(`Verified pinned Chrome ${browserVersion} (${platform}); existing cache retained`)
