import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { BRAND_ASSET_PATHS, BRAND_PATHS } from './brand-ownership.mjs'
import { githubEvidence } from './ci-delivery-api.mjs'
import { readSelectionSource } from './ci-selection-source.mjs'

const upstream = 'alex-morozov84/AMCore'

function withoutFields(text, paths) {
  const value = JSON.parse(text)
  for (const path of paths) {
    const keys = path.split('.')
    const key = keys.pop()
    const object = keys.reduce((current, name) => current?.[name], value)
    if (typeof object?.[key] !== 'string') throw new Error('Invalid initialization field')
    delete object[key]
  }
  return value
}

const dataPaths = new Map([
  [BRAND_PATHS.package, ['name', 'description']],
  [BRAND_PATHS.enMessages, ['meta.title', 'meta.description']],
  [BRAND_PATHS.ruMessages, ['meta.title']],
])

function permittedContent(path, before, after) {
  if (dataPaths.has(path)) {
    const fields = dataPaths.get(path)
    return isDeepStrictEqual(withoutFields(before, fields), withoutFields(after, fields))
  }
  if (path === BRAND_PATHS.manifest) {
    const literals =
      /^( {4}(?:name|short_name|description): )(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'),$/gm
    return before.replace(literals, '$1VALUE,') === after.replace(literals, '$1VALUE,')
  }
  if (path === BRAND_PATHS.theme) {
    const setting = /^export const DEFAULT_THEME_SETTING: ThemeSetting = '(?:system|light|dark)'$/m
    return before.replace(setting, 'THEME') === after.replace(setting, 'THEME')
  }
  return (
    path === BRAND_PATHS.context || path === 'ci/product.json' || BRAND_ASSET_PATHS.includes(path)
  )
}

export async function verifyForkInitialization(root, repository, payload, env) {
  const pr = payload.pull_request
  const evidenceEnv = { ...env, CI_EVIDENCE_TOKEN: env.CI_POLICY_TOKEN }
  const current = githubEvidence(evidenceEnv, repository)
  const canonical = githubEvidence(evidenceEnv, upstream)
  const id = env.GITHUB_REPOSITORY_ID
  if (
    !current ||
    !canonical ||
    repository.toLowerCase() === upstream.toLowerCase() ||
    !/^[1-9]\d*$/.test(id ?? '') ||
    pr?.base?.ref !== 'main' ||
    String(pr.base.repo?.id) !== id ||
    String(pr.head?.repo?.id) !== id
  )
    throw new Error('First product PR requires trusted fork metadata')

  const { source, diffComplete, changedFiles } = readSelectionSource(
    root,
    'pull_request',
    payload,
    env.GITHUB_SHA
  )
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const context = git('show', `${source.checkout}:PROJECT_CONTEXT.md`)
  const release = /^- \*\*initialized_from_amcore_version:\*\* (v\d+\.\d+\.\d+)$/m.exec(
    context
  )?.[1]
  if (!release || !diffComplete)
    throw new Error('First product PR requires a supported release base')

  const [fork, origin, published, base, main] = await Promise.all([
    current(''),
    canonical(''),
    canonical(`releases/tags/${release}`),
    canonical(`commits/${release}`),
    current('git/ref/heads/main'),
  ])
  if (
    fork.fork !== true ||
    !Number.isSafeInteger(origin.id) ||
    String(fork.id) !== id ||
    fork.parent?.id !== origin.id ||
    fork.source?.id !== origin.id ||
    origin.full_name !== upstream ||
    published.tag_name !== release ||
    published.draft !== false ||
    published.prerelease !== false ||
    base.sha !== source.base ||
    main.object?.sha !== source.base
  )
    throw new Error('First product PR is not based on the published AMCore release in this fork')

  for (const path of changedFiles) {
    const entry = (sha) => git('ls-tree', sha, '--', path).split(' ', 1)[0]
    if (
      entry(source.checkout) !== '100644' ||
      (entry(source.base) !== '100644' && path !== 'ci/product.json')
    )
      throw new Error(`Unsupported initialization file mode: ${path}`)
    const needsContent =
      dataPaths.has(path) || path === BRAND_PATHS.manifest || path === BRAND_PATHS.theme
    const read = (sha) => (needsContent ? git('show', `${sha}:${path}`) : '')
    if (!permittedContent(path, read(source.base), read(source.checkout)))
      throw new Error(`Outside supported product initialization: ${path}`)
  }
}
