import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { compose } from './docker.mjs'
import { snapshot } from './snapshot.mjs'

const web = [
  ['apps/web/src', ['ts', 'tsx', 'css', 'json']],
  ['apps/web/messages', ['json']],
  ['apps/web/public', ['js', 'png', 'ico']],
]
const api = [['apps/api/src', ['ts', 'tsx', 'json']]]
const shared = ['packages/shared/src', ['ts', 'tsx', 'json']]
const settings = ['locales', 'admin-console', 'product-admin']

export function watchDefinition(stand, service) {
  const inputs = service === 'web' ? web : api
  return {
    init: true,
    develop: {
      watch: [...inputs, shared].map(([path, extensions]) => ({
        path: join(stand.worktree, path),
        target: join('/app', path),
        action: path === shared[0] ? 'sync+restart' : 'sync',
        include: extensions.map((extension) => `**/*.${extension}`),
        ignore: [
          '**/.env*',
          '**/secrets',
          '**/node_modules',
          '**/generated',
          '**/dist',
          '**/build',
          '**/coverage',
          '**/__tests__',
          '**/__mocks__',
          '**/*.test.*',
          '**/*.spec.*',
          '**/*-spec.*',
          ...(path === shared[0] ? settings.map((name) => `config/${name}.json`) : []),
          ...(path === web[0][0] && stand.fixtureProfile === 'account-mfa-ui'
            ? ['_app/account-security/ui/client.tsx', '_app/account-security/ui/preview-adapter.ts']
            : []),
        ],
      })),
    },
  }
}

export async function watchStand(stand) {
  const ready = Promise.withResolvers()
  const tail = { stdout: '', stderr: '' }
  const watch = compose(stand, ['watch', '--no-up', '--prune=false', 'web', 'api', 'worker'], {
    onOutput(chunk, stream) {
      tail[stream] = (tail[stream] + chunk).slice(-256)
      if (tail[stream].includes('Watch enabled')) ready.resolve()
    },
  })
  await Promise.race([
    ready.promise,
    watch.then(() => {
      throw new Error('Compose Watch exited before it was ready. Rerun the command.')
    }),
    delay(15_000, null, { ref: false }).then(() => {
      throw new Error('Compose Watch did not become ready. Rerun the command.')
    }),
  ])
  if ((await snapshot(stand.worktree)) !== stand.sourceHash)
    throw new Error('Source changed during startup. Rerun the same command to include the changes.')
  console.log('Auto-update ready. Press Ctrl+C to stop watching and keep the stand running.')
  await watch
}
