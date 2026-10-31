import { invariant } from './lighthouse-plan.mjs'

export const scoreCategories = ['performance', 'accessibility', 'best-practices', 'seo']
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  )
export const escapeMarkdown = (value) =>
  [...escapeHtml(value)]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .replace(/[\\`*_[\]{}()#+.!|~-]/g, '\\$&')

export function expectedPages(plan, lane) {
  const ids = lane === undefined ? Object.values(plan.assignments).flat() : plan.assignments[lane]
  invariant(Array.isArray(ids) && new Set(ids).size === ids.length, 'invalid-view-assignment')
  invariant(
    Array.isArray(plan.pages) &&
      plan.pages.length === Object.values(plan.assignments).flat().length,
    'invalid-view-pages'
  )
  return ids.map((id) => {
    const pages = plan.pages.filter((p) => p.id === id)
    invariant(
      pages.length === 1 && id !== 'index' && /^[a-z][a-z0-9-]{0,50}$/.test(id),
      'invalid-view-page'
    )
    const owners = Object.entries(plan.assignments).filter(([, values]) => values.includes(id))
    invariant(owners.length === 1, 'invalid-view-owner')
    return { ...pages[0], owner: owners[0][0] }
  })
}

export function viewRows(plan, lane, manifest) {
  if (manifest) {
    invariant(
      ['run', 'attempt', 'source'].every((key) => manifest[key] === plan[key]) &&
        manifest.plan === plan.digest &&
        manifest.lane === lane,
      'view-provenance-mismatch'
    )
    const ids = manifest.results.map((r) => r.id)
    invariant(
      new Set(ids).size === ids.length && ids.every((id) => plan.assignments[lane].includes(id)),
      'unexpected-view-result'
    )
    invariant(
      manifest.files.every((f) =>
        manifest.results.some(
          (r) => r.valid === true && (f.name === `${r.id}.html` || f.name === `${r.id}.json`)
        )
      ),
      'unsafe-view-result-files'
    )
  }
  return expectedPages(plan, lane).map((page) => {
    const result = manifest?.results.find((r) => r.id === page.id)
    const valid = result?.valid === true
    invariant(
      !valid || (result.identity === true && result.requiredData === true),
      'unproved-view-identity'
    )
    const files = manifest?.files ?? []
    const filename = `${page.id}.html`
    const hasReport =
      valid &&
      files.some((f) => f.name === filename) &&
      files.some((f) => f.name === `${page.id}.json`)
    invariant(!valid || hasReport, 'missing-view-report-pair')
    const scores = valid ? result.policy?.scores : undefined
    invariant(
      !valid ||
        scoreCategories.every(
          (id) => Number.isFinite(scores?.[id]) && scores[id] >= 0 && scores[id] <= 1
        ),
      'invalid-view-scores'
    )
    return {
      ...page,
      status: !result
        ? 'Not run'
        : !valid
          ? 'Invalid'
          : result.policy.passed === true
            ? 'Passed'
            : 'Audit failures',
      scores,
      reason: !result
        ? 'No confirmed measurement; inspect command diagnostics.'
        : !valid
          ? 'Measurement invalid; inspect command diagnostics.'
          : undefined,
      filename: hasReport ? filename : undefined,
    }
  })
}

export function artifactUrl(value, plan, repository, server = 'https://github.com') {
  const origin = new URL(server)
  const url = new URL(value)
  invariant(
    origin.protocol === 'https:' &&
      !origin.username &&
      !origin.password &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
      url.origin === origin.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(`/${repository}/actions/runs/${plan.run}/artifacts/`) &&
      /^\d+$/.test(url.pathname.slice(`/${repository}/actions/runs/${plan.run}/artifacts/`.length)),
    'unsafe-artifact-url'
  )
  return url.href
}
