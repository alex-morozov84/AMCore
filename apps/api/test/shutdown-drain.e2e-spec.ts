import { type ChildProcess, spawn } from 'child_process'
import path from 'path'

describe('shutdown drain', () => {
  it('waits for async shutdown hooks after SIGTERM and exits naturally', async () => {
    const apiRoot = process.cwd()
    const fixture = path.join(apiRoot, 'test/fixtures/shutdown-drain.fixture.ts')
    const tsx = path.join(apiRoot, 'node_modules/.bin/tsx')
    const child = spawn(tsx, [fixture], {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'test', DRAIN_MS: '350' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const output: string[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()))

    await waitForOutput(child, output, 'ready:')
    child.kill('SIGTERM')

    const exit = await waitForExit(child)
    const combined = output.join('')

    expect(combined).toContain('drain:start:SIGTERM')
    expect(combined).toContain('drain:complete')
    expect(exit.signal).toBeNull()
    // Node/tsx may preserve SIGTERM as 143 after graceful hooks complete. The
    // invariant is that the drain completed and the process did not hang or get
    // SIGKILLed by the test timeout.
    expect(exit.code).toBe(143)
  }, 15_000)
})

function waitForOutput(child: ChildProcess, output: string[], marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      child.kill('SIGKILL')
      reject(new Error(`Timed out waiting for ${marker}. Output:\n${output.join('')}`))
    }, 10_000)

    const onData = (): void => {
      if (output.join('').includes(marker)) {
        cleanup()
        resolve()
      }
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(
        new Error(
          `Child exited before ${marker}: code=${code} signal=${signal}. Output:\n${output.join('')}`
        )
      )
    }

    const cleanup = (): void => {
      clearTimeout(timeout)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('exit', onExit)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', onExit)
    onData()
  })
}

function waitForExit(
  child: ChildProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Timed out waiting for child process exit'))
    }, 10_000)

    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}
