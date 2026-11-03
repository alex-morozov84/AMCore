const process = require('node:process')
const console = require('node:console')
const { appendFileSync, writeFileSync } = require('node:fs')
const { failure } = require('../ci-diagnostic.cjs')
class Reporter {
  record(row) {
    appendFileSync(
      process.env.AMCORE_E2E_PROGRESS,
      JSON.stringify({ ...row, pid: process.pid, attempt: process.env.AMCORE_E2E_ATTEMPT }) + '\n'
    )
  }
  onRunStart() {
    this.record({ event: 'run-start' })
  }
  onTestStart(test) {
    this.record({ event: 'suite-start', path: test.path })
  }
  onTestResult(test, result) {
    // Raw circus fields survive here; formatted Jest JSON need not retain retry metadata.
    const assertions = result.testResults.map(({ status, invocations, retryReasons }) => ({
      status,
      invocations,
      retryReasons: Array.isArray(retryReasons)
        ? retryReasons.map(() => 'detail-withheld')
        : retryReasons,
    }))
    const failures = result.testResults.flatMap((test, index) =>
      test.status === 'failed'
        ? [
            {
              assertion: index + 1,
              ...failure(test.failureDetails?.[0], {
                file: result.testFilePath,
                ...test.location,
              }),
            },
          ]
        : []
    )
    if (result.testExecError)
      failures.push({ ...failure(result.testExecError, { file: test.path }), phase: 'runtime' })
    if (failures.length) console.error('API E2E failure:', JSON.stringify(failures).slice(0, 8192))
    this.record({
      event: 'suite-end',
      path: test.path,
      assertions,
      runtimeError: Boolean(result.testExecError),
      firstError: failures[0] ?? (result.failureMessage ? { category: 'suite-failure' } : null),
      failures: failures.slice(0, 8),
      failure: Boolean(result.failureMessage),
      heap: process.memoryUsage().heapUsed,
      rss: process.memoryUsage().rss,
      maxRss: process.resourceUsage().maxRSS,
    })
  }
  onRunComplete(_contexts, result) {
    // Jest computes result.success only AFTER onRunComplete; inspect raw counts here.
    const success =
      !result.wasInterrupted &&
      !result.numFailedTests &&
      !result.numFailedTestSuites &&
      !result.numRuntimeErrorTestSuites &&
      !result.numPendingTests &&
      !result.numTodoTests &&
      !result.snapshot.failure &&
      result.numPassedTestSuites === 1 &&
      result.numPassedTests > 0
    writeFileSync(process.env.AMCORE_E2E_FINAL, JSON.stringify({ success }))
    this.record({ event: 'terminal', success })
  }
}
module.exports = Reporter
