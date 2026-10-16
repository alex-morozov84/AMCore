import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

export async function freeEsmPort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((ok, fail) => server.close((error) => (error ? fail(error) : ok())))
  return port
}

interface EsmProcess {
  child: ChildProcess
  finish: (stop?: boolean) => Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  output: () => string
}

/** A test-owned child only; production development remains owned by Nest CLI. */
export function esmProcess(entry: string, env: NodeJS.ProcessEnv): EsmProcess {
  return esmCommand([resolve('dist', entry)], env)
}

export function esmCommand(args: string[], env: NodeJS.ProcessEnv): EsmProcess {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (data) => (output += data))
  child.stderr.on('data', (data) => (output += data))
  const closed = once(child, 'close')
  async function finish(
    stop = false
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (stop && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const [code, signal] = await Promise.race([
        closed,
        new Promise<never>((_, fail) => {
          timer = setTimeout(() => {
            child.kill('SIGKILL')
            fail(new Error('Compiled API child required forced cleanup'))
          }, 25_000)
        }),
      ])
      const result = { code: code as number | null, signal: signal as NodeJS.Signals | null }
      mkdirSync('.amcore/esm', { recursive: true })
      const path = '.amcore/esm/runtime-processes.json'
      const records = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
      records.push({ args, requestedStop: stop, ...result, output })
      writeFileSync(path, JSON.stringify(records, null, 2))
      return result
    } finally {
      clearTimeout(timer)
      await closed
    }
  }
  return { child, finish, output: () => output }
}

export async function waitEsmHealth(port: number): Promise<void> {
  const end = Date.now() + 45_000
  while (Date.now() < end) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`, {
        signal: AbortSignal.timeout(500),
      })
      if (response.status === 200 && (await response.text()).includes('memory_heap')) return
    } catch {
      // Poll only this test's reserved application port.
    }
    await new Promise((ok) => setTimeout(ok, 50))
  }
  throw new Error('Compiled API did not expose its liveness response')
}
