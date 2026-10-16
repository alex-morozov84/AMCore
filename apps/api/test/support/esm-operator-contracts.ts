import { once } from 'node:events'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { esmCommand, esmProcess } from './esm-process'

/** Reusable compiled entrypoint contract; invoked only by its E2E suite. */
export function esmOperatorContracts(environment: () => NodeJS.ProcessEnv): void {
  it('compiled GeoIP command closes with downloads disabled', async () => {
    const env = environment()
    const command = esmProcess('cli/geoip-update.js', env)
    expect(await command.finish()).toEqual({ code: 0, signal: null })
  }, 45_000)

  it('compiled Telegram command refuses missing configuration without exposing it', async () => {
    const env = environment()
    const command = esmProcess('cli/telegram-setup.js', env)
    expect(await command.finish()).toEqual({ code: 1, signal: null })
    expect(command.output()).toContain('invalid/missing config')
    expect(command.output()).not.toContain('MODULE_NOT_FOUND')
  }, 45_000)

  it('compiled storage command refuses the nonpersistent memory driver', async () => {
    const env = environment()
    const command = esmProcess('cli/storage-check.js', { ...env, STORAGE_DRIVER: 'memory' })
    expect(await command.finish()).toEqual({ code: 1, signal: null })
    expect(command.output()).toContain('memory driver keeps nothing')
    expect(command.output()).not.toContain('MODULE_NOT_FOUND')
  }, 45_000)

  it('compiled operator imports are inert and symlink invocation still refuses memory', async () => {
    const env = environment()
    const root = mkdtempSync(join(tmpdir(), 'api-esm-command-'))
    try {
      const importer = join(root, 'importer.mjs')
      const paths = ['telegram-setup', 'storage-check'].map(
        (name) => pathToFileURL(resolve('dist/cli', `${name}.js`)).href
      )
      writeFileSync(
        importer,
        paths.map((path) => `await import(${JSON.stringify(path)})`).join(';') +
          ';console.log("operator imports completed")'
      )
      const imported = esmCommand([importer], env)
      expect(await imported.finish()).toEqual({ code: 0, signal: null })
      expect(imported.output()).toContain('operator imports completed')
      const alias = join(root, 'storage.mjs')
      symlinkSync(resolve('dist/cli/storage-check.js'), alias)
      const invoked = esmCommand([alias], { ...env, STORAGE_DRIVER: 'memory' })
      expect(await invoked.finish()).toEqual({ code: 1, signal: null })
      expect(invoked.output()).toContain('memory driver keeps nothing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('compiled Telegram command succeeds only against an owned loopback fixture', async () => {
    const env = environment()
    const requests: unknown[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        requests.push(JSON.parse(body))
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ ok: true, result: true }))
      })
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    try {
      const command = esmProcess('cli/telegram-setup.js', {
        ...env,
        TELEGRAM_BOT_TOKEN: '<fixture-token>',
        WEBHOOK_TELEGRAM_SECRET: 'fixture_secret',
        TELEGRAM_WEBHOOK_URL: 'https://example.invalid/webhooks/telegram',
        TELEGRAM_API_BASE_URL: `http://127.0.0.1:${port}`,
      })
      expect(await command.finish()).toEqual({ code: 0, signal: null })
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        url: 'https://example.invalid/webhooks/telegram',
        secret_token: 'fixture_secret',
        drop_pending_updates: false,
      })
      expect(command.output()).not.toContain('<fixture-token>')
      expect(command.output()).not.toContain('fixture_secret')
    } finally {
      await new Promise<void>((ok, fail) => server.close((error) => (error ? fail(error) : ok())))
    }
  }, 45_000)
}
