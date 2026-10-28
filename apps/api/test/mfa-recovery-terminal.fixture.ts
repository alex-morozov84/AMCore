import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'

/** Ephemeral owned test PTY only. /dev/null disables transcript files; plaintext never enters reports. */
export async function recoveryTerminalFixture(input: {
  userId: string
  databaseUrl: string
  confirm?: boolean
}): Promise<{
  status: number | null
  ticket: string | null
  body: Record<string, unknown>
  safeOutput: string
}> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.userId)) throw new Error('Invalid owned fixture identifier')
  const command = ['pnpm', 'auth:mfa', '--', 'recover', '--user-id', input.userId]
  const args =
    process.platform === 'darwin'
      ? ['-q', '-e', '/dev/null', ...command]
      : ['-q', '-e', '-c', command.join(' '), '/dev/null']
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: input.databaseUrl,
    }
    for (const key of ['JWT_SECRET', 'REDIS_URL', 'MFA_ACTIVE_KEY_ID', 'MFA_ENCRYPTION_KEYS'])
      delete env[key]
    // BSD script's terminal probing rejects Node socket-backed stdio. Ordinary pipes keep this bridge memory-only.
    const child = spawn(
      'bash',
      ['-o', 'pipefail', '-c', 'cat | script "$@" 2>&1 | cat', 'mfa-owned-pty', ...args],
      { env, stdio: 'pipe' }
    )
    let output = ''
    let reasonSent = false
    let confirmationSent = false
    let timedOut = false
    let inputEnded = false
    const timer = setTimeout(() => {
      timedOut = true
      child.stdin.end()
      child.kill('SIGTERM')
    }, 45000)
    const receive = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > 65536) {
        child.kill('SIGTERM')
        return
      }
      if (!inputEnded && /\{"status":/.test(output)) {
        inputEnded = true
        child.stdin.end()
      }
      if (!inputEnded && !reasonSent && output.includes('Reason (no passwords')) {
        reasonSent = true
        child.stdin.write('lost phone and backup codes\n')
      }
      if (
        !inputEnded &&
        !confirmationSent &&
        output.includes(`Type RESET ${input.userId} to confirm:`)
      ) {
        confirmationSent = true
        child.stdin.write(input.confirm === false ? 'CANCEL\n' : `RESET ${input.userId}\n`)
      }
    }
    child.stdout.on('data', receive)
    child.stderr.on('data', receive)
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('Owned recovery PTY could not start'))
    })
    child.once('close', (status) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error('Owned recovery PTY timed out'))
        return
      }
      const plain = stripVTControlCharacters(output)
      const ticket = /ENROLLMENT TICKET: ([A-Za-z0-9_-]{43})/.exec(plain)?.[1] ?? null
      const safeOutput = plain.replace(
        /ENROLLMENT TICKET: [A-Za-z0-9_-]{43}/g,
        'ENROLLMENT TICKET: [redacted]'
      )
      const lines = safeOutput.split(/[\r\n]+/).filter((line) => line.startsWith('{'))
      if (lines.length !== 1) {
        reject(
          new Error(
            `Owned recovery PTY did not emit one bounded outcome (exit=${status}, prompted=${reasonSent})`
          )
        )
        return
      }
      try {
        resolve({ status, ticket, body: JSON.parse(lines[0]!), safeOutput })
      } catch {
        reject(new Error('Owned recovery PTY outcome was invalid'))
      }
    })
  })
}
