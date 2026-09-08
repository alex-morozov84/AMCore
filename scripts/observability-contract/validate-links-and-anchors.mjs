// AMCore observability contract — every alert's runbook_path resolves to a
// real file + real heading anchor, and every relative Markdown link in the
// runbooks / dashboard README resolves to a real file.
import { existsSync } from 'node:fs'
import path from 'node:path'

import { extractRuleFiles } from './extract/yaml-rules.mjs'
import { extractHeadings, extractRelativeLinks, slugify } from './extract/runbook.mjs'

/** @returns {string[]} violation messages for runbook_path values that don't resolve. */
export function validateRunbookPaths(alertingRules) {
  const violations = []
  for (const rule of alertingRules) {
    if (!rule.runbookPath) continue
    const [filePart, anchor] = rule.runbookPath.split('#')
    if (!existsSync(filePart)) {
      violations.push(
        `${rule.file}:${rule.line}: alert ${rule.alertName}'s runbook_path file "${filePart}" does not exist`
      )
      continue
    }
    if (anchor && !extractHeadings(filePart).some((h) => h.slug === anchor)) {
      violations.push(
        `${rule.file}:${rule.line}: alert ${rule.alertName}'s runbook_path anchor "#${anchor}" has no matching heading in ${filePart}`
      )
    }
  }
  return violations
}

/** @returns {string[]} violation messages for relative links that don't resolve to a real file. */
export function validateRelativeLinks(markdownPaths) {
  const violations = []
  for (const mdPath of markdownPaths) {
    for (const link of extractRelativeLinks(mdPath)) {
      const [targetPath, anchor] = link.target.split('#')
      if (!targetPath) continue // pure in-page "#anchor" link
      const resolved = path.join(path.dirname(mdPath), targetPath)
      if (!existsSync(resolved)) {
        violations.push(
          `${link.file}:${link.line}: link target "${link.target}" does not resolve (${resolved})`
        )
        continue
      }
      if (
        anchor &&
        resolved.endsWith('.md') &&
        !extractHeadings(resolved).some((h) => h.slug === anchor)
      ) {
        violations.push(
          `${link.file}:${link.line}: link anchor "#${anchor}" has no matching heading in ${resolved}`
        )
      }
    }
  }
  return violations
}

export function runAgainstRealRepo({
  alertFiles = [
    'docs/operations/prometheus/amcore-alerts.yml',
    'docs/operations/prometheus/optional/amcore-slo-burn-rate.yml',
  ],
  markdownPaths = [
    'docs/operations/runbooks/http.md',
    'docs/operations/runbooks/db.md',
    'docs/operations/runbooks/redis.md',
    'docs/operations/runbooks/queues.md',
    'docs/operations/runbooks/email.md',
    'docs/operations/runbooks/realtime.md',
    'docs/operations/runbooks/node-runtime.md',
    'docs/operations/runbooks/metrics-collector-health.md',
    'docker/monitoring/grafana/dashboards/README.md',
  ],
} = {}) {
  const { alertingRules } = extractRuleFiles(alertFiles)
  return [...validateRunbookPaths(alertingRules), ...validateRelativeLinks(markdownPaths)]
}

export { slugify }
