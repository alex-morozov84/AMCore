#!/usr/bin/env node
// Dependency freshness reporter. Surfaces update signals Dependabot does NOT
// raise on its own: semver-major npm updates (ignored in dependabot.yml), Docker
// base-image digest drift, and curl-pinned CLI tool releases. Prints a Markdown
// report to stdout — side-effect-free; the workflow upserts the tracking issue
// from this output. Best-effort: a failing probe degrades to a note in the
// report, never a nonzero exit or a thrown error.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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

function npmMajors() {
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
  const rows = Object.entries(data)
    .filter(([, v]) => v?.current && v?.latest && major(v.latest) > major(v.current))
    .map(([name, v]) => ({ name, current: v.current, latest: v.latest, type: v.dependencyType ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { rows }
}

function dockerDrift() {
  let dockerfile
  try {
    dockerfile = readFileSync('apps/api/Dockerfile', 'utf8')
  } catch {
    return { error: '`apps/api/Dockerfile` not found' }
  }
  const m = dockerfile.match(/FROM\s+(\S+?:\S+?)@sha256:([0-9a-f]{64})/)
  if (!m) return { error: 'no digest-pinned base image found' }
  const [, ref, pinned] = m
  const res = run('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', '{{.Manifest.Digest}}'], 20000)
  const current = res.ok ? res.out.replace(/^sha256:/, '') : null
  return { ref, pinned, current }
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
  const res = run('bash', ['-c', `grep -rhoE '${varName}:[[:space:]]*[0-9][0-9.]*' .github/workflows | head -1`], 10000)
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

function render({ npm, docker, cli }) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const out = [
    '<!-- dependency-freshness:auto -->',
    '# Dependency freshness report',
    '',
    `_Auto-generated ${now} UTC by \`.github/workflows/dependency-freshness.yml\`, rewritten in place each run._`,
    '',
    '**How to use this issue.** It is a living dashboard, not a task list. For each',
    'item, either open a normal PR to update it (majors: their own PR + CI; CLI tools:',
    'version + sha256 together; Docker digest: re-resolve and bump both `FROM` lines),',
    'or leave it if it is an intentionally-deferred item — the _why_ for those lives in',
    'the maintainer backlog, not here. Do **not** close this issue: it is rewritten',
    'weekly, and an item drops off automatically once updated.',
    '',
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
  if (docker.error) out.push(`> ⚠️ ${docker.error}`, '')
  else if (!docker.current) out.push(`> ❔ Could not resolve the current digest for \`${docker.ref}\`.`, '')
  else if (docker.current === docker.pinned) out.push(`✅ \`${docker.ref}\` pin matches the upstream digest.`, '')
  else
    out.push(
      `⚠️ \`${docker.ref}\` moved upstream — re-resolve and bump both \`FROM\` lines.`,
      '',
      `- pinned:  \`sha256:${docker.pinned}\``,
      `- current: \`sha256:${docker.current}\``,
      '',
    )

  out.push('', '## curl-pinned CLI tools', '', '| Tool | Pinned | Latest | |', '|---|---|---|---|')
  for (const c of cli) {
    const mark = c.pinned == null || c.latest == null ? '❔' : c.stale ? '⚠️' : '✅'
    out.push(`| \`${c.tool}\` | ${c.pinned ?? '?'} | ${c.latest ?? '?'} | ${mark} |`)
  }
  out.push('')
  return out.join('\n')
}

console.log(render({ npm: npmMajors(), docker: dockerDrift(), cli: cliDrift() }))
