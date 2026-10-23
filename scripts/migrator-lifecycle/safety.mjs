import { clearTimeout, setTimeout } from 'node:timers'

export async function bounded(operation, milliseconds, code) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// Never serialize arbitrary messages, command output, SQL or connection strings.
export function safeError(error) {
  const checks = new Set([
    'Database session survived cancellation',
    'Database lock survived cancellation',
    'Attached client was terminated by harness',
    'Require natural nonzero exit before 45s',
    'Migrator exited before active SQL',
    'Expected exactly one sleeping migration session',
    'Cancelled migration marked finished',
    'Unexpected migration ledger count',
    'Container still running',
    'Container OOM killed',
    'Container exit code mismatch',
    'Transactional table/data survived cancellation',
    'Refuse a foreign resource',
    'Container cleanup incomplete',
    'Network cleanup incomplete',
    'Fixture network must forbid external routing',
    'Migrator must join only the fixture network',
  ])
  return {
    code: /^[A-Z0-9_]{1,40}$/.test(String(error?.code)) ? error.code : 'HARNESS_ERROR',
    check: checks.has(error?.message?.split('\n')[0]) ? error.message.split('\n')[0] : undefined,
    causes: error instanceof AggregateError ? error.errors.map(safeError) : undefined,
  }
}

export function report(f, verdict, details) {
  const entry = { run: f.run, verdict, ...details }
  console.log(JSON.stringify(entry))
  f.history.push(entry)
  try {
    f.journal()
  } catch (error) {
    f.journalErrors ??= []
    f.journalErrors.push(error)
    console.error(
      JSON.stringify({ run: f.run, verdict: 'ERROR', phase: 'journal', error: safeError(error) })
    )
  }
}

export function checkpoint(f) {
  if (f.interrupted) throw Object.assign(new Error('Harness interrupted'), { code: f.interrupted })
  if (f.journalErrors?.length) throw new AggregateError(f.journalErrors, 'Recovery journal failed')
}

export async function closeClient(client) {
  if (!client) return
  try {
    await bounded(client.end(), 5000, 'CLIENT_CLOSE_TIMEOUT')
  } catch (error) {
    client.connection?.stream?.destroy()
    throw error
  }
}

export async function withClient(f, url, operation) {
  const client = new f.Client({
    connectionString: url,
    query_timeout: 5000,
    connectionTimeoutMillis: 10000,
  })
  let failure, result
  try {
    await client.connect()
    result = await operation(client)
  } catch (error) {
    failure = error
  }
  try {
    await closeClient(client)
  } catch (error) {
    throw new AggregateError(failure ? [failure, error] : [error], 'Ledger client failed')
  }
  if (failure) throw failure
  return result
}
