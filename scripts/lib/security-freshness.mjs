// Read-only probes. A failed probe is unknown, never evidence of safety or a hold.
const cell = (value) =>
  String(value ?? 'unknown')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')

function json(run, command, args, token) {
  const result = run(command, args, 20000, token)
  if (!result.ok) return null
  try {
    return JSON.parse(result.out)
  } catch {
    return null
  }
}

function alerts(run, repository, family, token) {
  const pages = json(
    run,
    'gh',
    [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/${family}/alerts?state=open&per_page=100`,
    ],
    token
  )
  return Array.isArray(pages) && pages.every(Array.isArray) ? pages.flat() : null
}

function parents(run, name, version) {
  const graph = json(run, 'pnpm', ['-r', 'why', name, '--json'])
  if (!Array.isArray(graph)) return null
  return graph
    .filter((entry) => entry.version === version)
    .flatMap((entry) => entry.dependents ?? [])
    .map((entry) => `${entry.name}@${entry.version}`)
    .filter((entry, index, rows) => rows.indexOf(entry) === index)
}

function parentEvidence(run, parent, dependency) {
  const split = parent.lastIndexOf('@')
  const name = parent.slice(0, split)
  const data = json(run, 'pnpm', [
    'view',
    `${name}@latest`,
    'version',
    'dependencies',
    'peerDependencies',
    '--json',
  ])
  if (!data || typeof data.version !== 'string') return `${parent}: registry probe unavailable`
  const range = data.dependencies?.[dependency] ?? data.peerDependencies?.[dependency]
  return `${parent}; latest ${data.version}; requires ${dependency} ${range ?? 'absent (review migration)'}`
}

function dependencyRows(run, rows) {
  const out = [
    '| Alert | Package | Fixed version | Installed parents and latest release requirements | Blocker / next trigger |',
    '|---|---|---|---|---|',
  ]
  const cache = new Map()
  for (const alert of rows) {
    const name = alert.dependency?.package?.name
    const version = alert.dependency?.version_requirement
    const fixed = alert.security_vulnerability?.first_patched_version?.identifier
    const key = `${name}@${version}`
    if (!cache.has(key)) {
      const found = name && version ? parents(run, name, version) : null
      cache.set(
        key,
        found?.length
          ? found.map((parent) => parentEvidence(run, parent, name)).join('; ')
          : 'Unknown: dependency graph unavailable or alert version absent from this checkout'
      )
    }
    const next = fixed
      ? 'Needs investigation: compare declared ranges with the fix; admit a supported parent release, then run consumer checks. No overrides.'
      : 'No patched release listed by GitHub; recheck on advisory or supported parent/replacement release.'
    out.push(
      `| [#${alert.number}](${alert.html_url}) | ${cell(key)} | ${cell(fixed ?? 'none listed')} | ${cell(cache.get(key))} | ${next} |`
    )
  }
  return out
}

export function securityFreshness(run, repository, dependabotToken) {
  const out = [
    '## Security update blockers',
    '',
    'Snapshot of open GitHub alerts, not a new scan. Parent evidence comes from this installed checkout and npm latest; it does not prove compatibility.',
    'Failed update jobs appear in Dependabot health. Their failure alone does not explain an individual alert.',
    '',
  ]
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    return [...out, '> ❔ Repository context unavailable; set GH_REPO.', '']
  const dependencies = alerts(run, repository, 'dependabot', dependabotToken)
  out.push('### Dependabot', '')
  if (dependencies === null)
    out.push(
      '> ❔ Alerts unavailable. Configure the DEPENDABOT_READ_TOKEN Actions secret with Dependabot alerts read access for this repository, or check its expiry/access. This does not mean zero alerts.'
    )
  else if (!dependencies.length)
    out.push('_No open Dependabot alerts. Code scanning is reported separately._')
  else out.push(...dependencyRows(run, dependencies))
  out.push('', '### Code scanning', '')
  const scans = alerts(run, repository, 'code-scanning')
  if (scans === null)
    out.push('> ❔ Code scanning unavailable (check security-events: read/API access).')
  else if (!scans.length) out.push('_No open code scanning alerts._')
  else {
    out.push('| Alert | Source / commit | Finding | Next trigger |', '|---|---|---|---|')
    for (const alert of scans) {
      const instance = alert.most_recent_instance ?? {}
      const image = instance.category?.startsWith('trivy-image')
      const next = image
        ? 'Supported distro/base/toolchain fix: rebuild and scan the actual image. Unchanged digest does not prove installed OS packages are current.'
        : 'Advisory or supported parent release: compare dependency evidence above. Missing match needs investigation.'
      out.push(
        `| [#${alert.number}](${alert.html_url}) | ${cell(instance.category)} / ${cell(instance.commit_sha)} | ${cell(instance.message?.text)} | ${next} |`
      )
    }
  }
  return [
    ...out,
    '',
    'Recheck weekly, on advisory changes and supported releases, and before release. Keep existing holds and consumer checks; no automatic major migration or alert dismissal.',
    '',
  ]
}
