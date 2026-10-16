import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { esmCommand, esmProcess } from './esm-process'

/** Compiled setup entrypoint proof shares the existing owned ESM suite. */
export function organizationSetupOperatorContracts(environment: () => NodeJS.ProcessEnv): void {
  it('compiled setup refuses invalid input with safe JSON and natural exit', async () => {
    const command = esmProcess('cli/organization-setup.js', environment())
    expect(await command.finish()).toEqual({ code: 2, signal: null })
    expect(JSON.parse(command.output())).toMatchObject({ status: 'invalid_input' })
  }, 30_000)

  it('compiled setup reports an unavailable database without exposing configuration', async () => {
    const command = esmCommand([resolve('dist/cli/organization-setup.js'), 'status'], {
      ...environment(),
      DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/unavailable',
      ORG_SELF_SERVICE_CREATION_ENABLED: 'false',
    })
    expect(await command.finish()).toEqual({ code: 4, signal: null })
    expect(JSON.parse(command.output())).toMatchObject({
      status: 'SETUP_UNCONFIRMED',
      state: 'unavailable',
    })
    expect(command.output()).not.toMatch(/postgresql|fixture|127\.0\.0\.1|password|token/i)
  }, 30_000)

  it('compiled setup import is inert and symlink invocation executes its guard', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'api-esm-organization-setup-'))
    try {
      const entry = resolve('dist/cli/organization-setup.js')
      const importer = join(directory, 'importer.mjs')
      writeFileSync(
        importer,
        `await import(${JSON.stringify(pathToFileURL(entry).href)});console.log('setup import completed')`
      )
      const imported = esmCommand([importer], environment())
      expect(await imported.finish()).toEqual({ code: 0, signal: null })
      expect(imported.output().trim()).toBe('setup import completed')
      const alias = join(directory, 'setup.mjs')
      symlinkSync(entry, alias)
      const invoked = esmCommand([alias], environment())
      expect(await invoked.finish()).toEqual({ code: 2, signal: null })
      expect(JSON.parse(invoked.output())).toMatchObject({ status: 'invalid_input' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
}
