import { escapeHtml as h, scoreCategories } from './lighthouse-view-model.mjs'

function rowHtml(row) {
  const scores = scoreCategories
    .map((key) => `<td>${row.scores ? Math.round(row.scores[key] * 100) : '—'}</td>`)
    .join('')
  const link = row.filename
    ? `<a href="${h(row.filename)}">Open full report</a>`
    : 'Unavailable — no safe full report'
  return `<tr><th scope="row">${h(row.label)}<br><small>${h(row.path)}</small></th><td>${h(row.owner)}</td><td>${h(row.status)}${row.reason ? `<br><small>${h(row.reason)}</small>` : ''}</td>${scores}<td>${link}</td></tr>`
}

export function renderIndex(plan, scope, rows) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lighthouse reports — ${h(plan.run)} / ${h(plan.attempt)}</title>
<style>:root{color-scheme:light dark}body{font:1rem/1.5 system-ui;margin:2rem;max-width:90rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid GrayText;padding:.6rem;text-align:left;vertical-align:top}small{font-weight:normal;overflow-wrap:anywhere}.scroll{overflow:auto}a{white-space:nowrap}</style></head>
<body><h1>Lighthouse reports</h1><p>Run ${h(plan.run)} · Attempt ${h(plan.attempt)} · Source ${h(plan.source)}</p>
<p>Scope: ${h(scope)}. This index covers only the pages listed below.</p>
<p>Raw category scores are informational. The result also checks individual defects. Readable reports do not make an incomplete run successful.</p>
<div class="scroll"><table><caption>Page results — ${rows.length} expected in this scope</caption><thead><tr><th scope="col">Page / route</th><th scope="col">Owner</th><th scope="col">Result</th><th scope="col">Performance</th><th scope="col">Accessibility</th><th scope="col">Best Practices</th><th scope="col">SEO</th><th scope="col">Full report</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
<p>Invalid or not-run pages have no confirmed score or safe full report. Check the command or CI run for the failure. Keep the extracted files together; use your browser's Back action to return to this index.</p></body></html>
`
}
