const { appendFileSync, writeFileSync } = require('node:fs')
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
      retryReasons,
    }))
    this.record({
      event: 'suite-end',
      path: test.path,
      assertions,
      runtimeError: Boolean(result.testExecError),
      firstError: result.testExecError?.message || result.failureMessage || null,
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
