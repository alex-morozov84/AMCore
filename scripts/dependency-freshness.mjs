#!/usr/bin/env node
// Dependency freshness reporter. Surfaces update signals Dependabot does NOT
// raise on its own: semver-major npm updates (ignored in dependabot.yml), Docker
// base-image digest drift, curl-pinned CLI tool releases, and pnpm/Node toolchain pins. Prints a Markdown
// report to stdout — side-effect-free; the workflow upserts the tracking issue
// from this output. Best-effort: a failing probe degrades to a note in the
// report, never a nonzero exit or a thrown error.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { backlogCount, renderDependabotHealth } from './lib/dependabot-health.mjs'
import { renderToolchain, toolchainFreshness } from './lib/toolchain-freshness.mjs'
import { dockerPins, migratorFreshness, renderMigrator } from './lib/migrator-freshness.mjs'

// Every probe is bounded: on timeout execFileSync kills the child and throws, so
// a slow/hanging registry or API degrades to a note in the report instead of
// stalling the job. `pnpm outdated` is legitimately slow (whole workspace), so it
// gets a generous budget; network one-shots get short ones so `❔` appears fast.
const run = (cmd, args, timeoutMs = 30000) => {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    })
    return { ok: true, out: out.trim() }
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '').trim() }
  }
}

const major = (v) => Number.parseInt(String(v).replace(/^\D+/, '').split('.')[0], 10)

function loadOutdated() {
  // pnpm outdated exits non-zero when anything is outdated; capture stdout anyway.
  // `-r` may prefix the stream with a workspace/engine-warning line that itself
  // contains `{` (e.g. `{"node":">=24.0.0"}`), so anchor on the first line that
  // *starts* with `{` — the JSON object, pretty-printed or compact — then take
  // from its first `{` to the last `}`. The warning line starts with `.`/`[WARN]`.
  const { ok, out } = run('pnpm', ['-r', 'outdated', '--format', 'json'], 120000)
  const lines = out.split('\n')
  const startLine = lines.findIndex((line) => line.trim().startsWith('{'))
  const body = startLine === -1 ? '' : lines.slice(startLine).join('\n')
  if (!ok && !body) return { error: 'could not run `pnpm outdated`' }
  let data
  try {
    data = body ? JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) : {}
  } catch {
    return { error: 'could not parse `pnpm outdated` output' }
  }
  return { data }
}

function npmMajors({ data, error }) {
  if (error) return { error }
  const rows = Object.entries(data)
    .filter(([, v]) => v?.current && v?.latest && major(v.latest) > major(v.current))
    .map(([name, v]) => ({
      name,
      current: v.current,
      latest: v.latest,
      type: v.dependencyType ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { rows }
}

const RUN_FIELDS = 'name,status,conclusion,createdAt,updatedAt'

function dependabotRuns() {
  // Needs `actions: read` and a repository context (GH_REPO in the workflow).
  const args = ['run', 'list', '--workflow', 'Dependabot Updates', '--limit', '100']
  const { ok, out } = run('gh', [...args, '--json', RUN_FIELDS], 30000)
  try {
    if (ok) return { rows: JSON.parse(out) }
  } catch {
    // fall through to the note below
  }
  return { error: 'could not list the Dependabot update runs' }
}

const DOCKERFILES = ['apps/api/Dockerfile', 'apps/web/Dockerfile']

function dockerDrift(path) {
  let dockerfile
  try {
    dockerfile = readFileSync(path, 'utf8')
  } catch {
    return [{ path, error: `\`${path}\` not found` }]
  }
  const pins = dockerPins(path, dockerfile)
  if (!pins.length) return [{ path, error: 'no digest-pinned base image found' }]
  return pins.map((pin) => {
    const res = run(
      'docker',
      ['buildx', 'imagetools', 'inspect', pin.ref, '--format', '{{.Manifest.Digest}}'],
      20000
    )
    const current = res.ok ? res.out.replace(/^sha256:/, '') : null
    return { ...pin, path: `${path} (${pin.stages.join(', ')})`, current }
  })
}

// tool -> upstream repo + the `<VAR>: <version>` pin declared in a workflow file.
const TOOLS = [
  { tool: 'trivy', repo: 'aquasecurity/trivy', varName: 'TRIVY_VERSION' },
  { tool: 'actionlint', repo: 'rhysd/actionlint', varName: 'ACTIONLINT_VERSION' },
  { tool: 'zizmor', repo: 'zizmorcore/zizmor', varName: 'ZIZMOR_VERSION' },
  { tool: 'gitleaks', repo: 'gitleaks/gitleaks', varName: 'GITLEAKS_VERSION' },
  { tool: 'osv-scanner', repo: 'google/osv-scanner', varName: 'OSV_SCANNER_VERSION' },
]

function pinnedVersion(varName) {
  const res = run(
    'bash',
    ['-c', `grep -rhoE '${varName}:[[:space:]]*[0-9][0-9.]*' .github/workflows | head -1`],
    10000
  )
  const m = res.out.match(/([0-9][0-9.]*)/)
  return m ? m[1] : null
}

function cliDrift() {
  return TOOLS.map(({ tool, repo, varName }) => {
    const pinned = pinnedVersion(varName)
    const res = run('gh', ['api', `repos/${repo}/releases/latest`, '-q', '.tag_name'], 15000)
    const latest = res.ok && res.out ? res.out.replace(/^v/, '') : null
    return { tool, repo, pinned, latest, stale: Boolean(pinned && latest && pinned !== latest) }
  })
}

function render({ npm, health, docker, cli, migrator, toolchain }) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const out = [
    '<!-- dependency-freshness:auto -->',
    '# Dependency freshness report',
    '',
    `_Auto-generated ${now} UTC by \`.github/workflows/dependency-freshness.yml\`, rewritten in place each run._`,
    '',
    '**How to use this issue.** It is a living dashboard, not a task list. For each',
    'item, either open a normal PR to update it (majors: their own PR + CI; CLI tools:',
    'version + sha256 together; Docker digest: inspect and update the affected `FROM` stages),',
    'or leave it if it is an intentionally-deferred item — the _why_ for those lives in',
    'the maintainer backlog, not here. Do **not** close this issue: it is rewritten',
    'weekly, and an item drops off automatically once updated.',
    '',
    ...health,
    '## Pending major updates (Dependabot ignores majors)',
    '',
  ]
  if (npm.error) out.push(`> ⚠️ ${npm.error}`, '')
  else if (!npm.rows.length) out.push('_None._', '')
  else {
    out.push('| Package | Current | Latest | Type |', '|---|---|---|---|')
    for (const r of npm.rows) out.push(`| \`${r.name}\` | ${r.current} | ${r.latest} | ${r.type} |`)
    out.push('')
  }

  out.push('## Docker base image digest', '')
  for (const d of docker) {
    if (d.error) out.push(`> ⚠️ ${d.path}: ${d.error}`, '')
    else if (!d.current)
      out.push(`> ❔ Could not resolve the current digest for \`${d.ref}\` (${d.path}).`, '')
    else if (d.current === d.pinned)
      out.push(`✅ \`${d.path}\`: \`${d.ref}\` pin matches the upstream digest.`, '')
    else
      out.push(
        `⚠️ \`${d.path}\`: \`${d.ref}\` moved upstream — review every affected \`FROM\` stage.`,
        '',
        `- pinned:  \`sha256:${d.pinned}\``,
        `- current: \`sha256:${d.current}\``,
        ''
      )
  }

  out.push(...renderToolchain(toolchain), ...renderMigrator(migrator))
  out.push('', '## curl-pinned CLI tools', '', '| Tool | Pinned | Latest | |', '|---|---|---|---|')
  for (const c of cli) {
    const mark = c.pinned == null || c.latest == null ? '❔' : c.stale ? '⚠️' : '✅'
    out.push(`| \`${c.tool}\` | ${c.pinned ?? '?'} | ${c.latest ?? '?'} | ${mark} |`)
  }
  out.push('')
  return out.join('\n')
}

const outdated = loadOutdated()

console.log(
  render({
    npm: npmMajors(outdated),
    health: renderDependabotHealth({
      runs: dependabotRuns(),
      backlog: outdated.error ? { error: outdated.error } : { count: backlogCount(outdated.data) },
    }),
    docker: DOCKERFILES.flatMap(dockerDrift),
    cli: cliDrift(),
    migrator: await migratorFreshness(process.cwd()),
    toolchain: await toolchainFreshness(process.cwd()),
  })
)
