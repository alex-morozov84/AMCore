// Plan builders for the one-time Operations Console scaffold dimension.
import path from 'node:path'
import ownedPaths from './admin-console-owned-paths.json' with { type: 'json' }
import {
  deleteFileStep,
  fileStep,
  moveFileStep,
  removeMarkedBlock,
  replaceAllExactText,
  replaceExactBlock,
} from './init-engine.mjs'
import { resolveAdminConsolePaths } from './project-config-admin-console.mjs'
import { buildAdminConsoleDisableWebSteps } from './project-plan-admin-console-disable-web.mjs'
import { buildAdminConsoleDisableDocsSteps } from './project-plan-admin-console-disable-docs.mjs'

const CONFIG_DEFAULT = `  enabled: true,
  mode: 'path',
  slug: 'admin',`

function configBlock({ mode, slug }) {
  return `  enabled: true,
  mode: '${mode}',
  slug: '${slug}',`
}

function relative(root, target) {
  return target.slice(root.length + 1)
}

function replaceConsoleSlug(content, slug) {
  return replaceAllExactText(content, '/admin', `/${slug}`)
}

export function buildAdminConsoleEnableSteps(
  root,
  choice,
  { moveRoute = true, rewriteProxy = true } = {}
) {
  const paths = resolveAdminConsolePaths(root, choice.slug)
  const steps = [
    fileStep(
      paths.config,
      (content) => replaceExactBlock(content, CONFIG_DEFAULT, configBlock(choice)),
      'write the Operations Console runtime mode and slug'
    ),
  ]

  if (choice.slug !== 'admin') {
    if (moveRoute) {
      steps.push(
        moveFileStep(paths.defaultRoute, paths.route, `rename the console route to ${choice.slug}`)
      )
    }
    if (rewriteProxy) {
      steps.push(
        fileStep(
          path.join(root, 'docker/nginx/operations-console.conf'),
          (content) => replaceConsoleSlug(content, choice.slug),
          'rewrite the nginx physical console route for the chosen slug'
        ),
        fileStep(
          path.join(root, 'docker/caddy/Caddyfile.console-host'),
          (content) => replaceConsoleSlug(content, choice.slug),
          'rewrite the Caddy physical console route for the chosen slug'
        )
      )
    }
  }
  return steps
}

export function buildAdminConsoleDisableSteps(root, { keptLocale } = {}) {
  const paths = resolveAdminConsolePaths(root)
  const deletionTargets = [
    paths.defaultRoute,
    paths.config,
    ...ownedPaths.directories.map((target) => path.join(root, target)),
    ...ownedPaths.files.map((target) => path.join(root, target)),
  ]

  return [
    ...deletionTargets.map((target) =>
      deleteFileStep(target, `delete console-owned ${relative(root, target)}`)
    ),
    fileStep(
      path.join(root, 'docker/nginx/operations-console.conf'),
      (content) => removeMarkedBlock(content, 'AMCORE_ADMIN_CONSOLE_PROXY'),
      'remove the console nginx proxy block between its owned sentinels'
    ),
    ...buildAdminConsoleDisableWebSteps(root, { keptLocale }),
    ...buildAdminConsoleDisableDocsSteps(root),
  ]
}
