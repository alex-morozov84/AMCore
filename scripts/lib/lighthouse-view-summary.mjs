import { escapeMarkdown as m, expectedPages, viewRows } from './lighthouse-view-model.mjs'

const identity = (plan) =>
  `Run ${m(plan.run)} · Attempt ${m(plan.attempt)} · Source ${m(plan.source)} · Plan ${m(plan.digest)}`

export function expectedSummary(plan) {
  return (
    `### Lighthouse — expected pages\n\n${identity(plan)}\n\n` +
    'Inventory only: **Expected only — result not confirmed here**. After completion, an expected page without a matching result from its assigned owner in this attempt is **Result unavailable / run incomplete**. Another owner or older attempt cannot replace it.\n\n' +
    '| Page | Route | Assigned owner | Meaning |\n|---|---|---|---|\n' +
    expectedPages(plan)
      .map((p) => `| ${m(p.label)} | ${m(p.path)} | ${m(p.owner)} | Expected only |`)
      .join('\n') +
    '\n'
  )
}

export function resultSummary(plan, lane, manifest, url) {
  return (
    `### Lighthouse — results\n\n${identity(plan)}\n\nOwner: ${m(lane)}. Artifact: ${m(`web-lighthouse-${plan.run}-${plan.attempt}-${lane}`)}. Owner-reported outcomes; the original aggregate still decides complete evidence.\n\n` +
    '| Page | Route | Result | Reports |\n|---|---|---|---|\n' +
    viewRows(plan, lane, manifest)
      .map(
        (p) =>
          `| ${m(p.label)} | ${m(p.path)} | ${m(p.status)} | ${url ? `[Download reports](${url})` : 'Download unavailable'} |`
      )
      .join('\n') +
    '\n'
  )
}
