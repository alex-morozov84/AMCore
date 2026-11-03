const process = require('node:process')
const console = require('node:console')
const { Buffer } = require('node:buffer')
const { appendFileSync, mkdirSync, statSync, readFileSync, realpathSync } = require('node:fs')
const { dirname, resolve, sep } = require('node:path')
const { failure, sourceLocation, contextReads } = require('./ci-diagnostic.cjs')

class Reporter {
  constructor() {
    this.omitted = 0
    this.attempts = 0
    this.failed = 0
  }
  record(row) {
    const path = process.env.AMCORE_CI_DIAGNOSTICS
    if (!path) throw new Error('Missing safe browser diagnostic output')
    mkdirSync(dirname(path), { recursive: true })
    const line = JSON.stringify(row) + '\n'
    const bytes = (() => {
      try {
        return statSync(path).size
      } catch {
        return 0
      }
    })()
    if (bytes + Buffer.byteLength(line) > 56 * 1024) {
      this.omitted++
      return
    }
    appendFileSync(path, line, { mode: 0o600 })
  }
  onTestEnd(test, result) {
    this.attempts++
    if (result.status !== 'passed') this.failed++
    const row = {
      ...sourceLocation(test.location.file, test.location.line, test.location.column),
      retry: Number.isInteger(result.retry) ? result.retry : null,
      status: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status)
        ? result.status
        : 'unknown',
      duration: Number.isFinite(result.duration) ? result.duration : null,
      errors: result.errors.slice(0, 4).map((error) => failure(error, test.location)),
    }
    this.record(row)
    if (result.status !== 'passed') this.firstFailure ??= row
    for (const attachment of result.attachments ?? []) {
      if (attachment.name !== 'adoption-authority-counts' || !attachment.path) continue
      try {
        const path = realpathSync(attachment.path)
        const stands = resolve(dirname(process.env.AMCORE_CI_DIAGNOSTICS), '../stands')
        if (!path.startsWith(stands + sep) || statSync(path).size > 16 * 1024) continue
        const data = JSON.parse(readFileSync(path, 'utf8'))
        this.record({
          event: 'context-reads',
          retry: result.retry,
          requests: contextReads(data),
          returnDocument: {
            status: Number.isInteger(data.returnDocument?.status)
              ? data.returnDocument.status
              : null,
            redirected:
              typeof data.returnDocument?.redirected === 'boolean'
                ? data.returnDocument.redirected
                : null,
          },
        })
      } catch {
        this.record({ event: 'context-reads-unavailable', retry: result.retry })
      }
    }
    if (result.status !== 'passed') console.error('Browser test failure:', JSON.stringify(row))
  }
  onError(error) {
    this.record({ event: 'runtime-error', ...failure(error) })
  }
  onEnd(result) {
    const row = {
      event: 'terminal',
      status: ['passed', 'failed', 'timedout', 'interrupted'].includes(result.status)
        ? result.status
        : 'unknown',
      attempts: this.attempts,
      failed: this.failed,
      omitted: this.omitted,
      firstFailure: this.firstFailure,
    }
    const path = process.env.AMCORE_CI_DIAGNOSTICS
    if (!path) throw new Error('Missing safe browser diagnostic output')
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(row) + '\n', { mode: 0o600 })
    console.log('Browser result:', JSON.stringify(row))
  }
}
module.exports = Reporter
