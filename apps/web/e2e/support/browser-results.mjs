import { error as logError } from 'node:console'

import { writeFileSync } from 'node:fs'
import { proveBrowserCases } from '../../../../scripts/stand/browser-case-evidence.mjs'

// Store only the case-set hash and run identity. Raw Playwright JSON records secret-bearing steps.
export default class BrowserResults {
  onBegin(_config, suite) {
    this.tests = suite.allTests()
  }

  onEnd(result) {
    if (result.status !== 'passed') return
    try {
      const { expected, file, ...identity } = JSON.parse(process.env.AMCORE_BROWSER_REPORT)
      const tests = this.tests.filter(({ expectedStatus }) => expectedStatus !== 'skipped')
      const observed = proveBrowserCases(tests, expected)
      writeFileSync(file, JSON.stringify({ ...identity, observed }), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      logError(error.message)
      return { status: 'failed' }
    }
  }
}
