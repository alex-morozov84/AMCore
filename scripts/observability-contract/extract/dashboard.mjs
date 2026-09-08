// AMCore observability contract — builds a rows[] -> panels[] -> targets[]
// model from a Grafana dashboard JSON export, matching how Grafana itself
// groups panels under a preceding `type: "row"` panel.
import { readFileSync } from 'node:fs'

/**
 * Builds a rows[] -> panels[] -> targets[] model from a flat Grafana panels
 * array (the classic dashboard schema: a `type: "row"` panel followed by its
 * member panels). Shared by the committed dashboard JSON and, live, by
 * Grafana's own classic-schema (`v1`) dashboard DTO — both use this shape.
 * @returns {{ rows: { title: string, panels: { id: number, title: string,
 *   targets: { expr: string, datasource: { type?: string, uid?: string } }[]
 * }[] }[] }}
 */
export function buildDashboardModel(panels, sourceLabel) {
  const rows = []
  let currentRow = null

  for (const panel of panels ?? []) {
    if (panel.type === 'row') {
      currentRow = { title: panel.title, panels: [] }
      rows.push(currentRow)
      continue
    }
    if (!currentRow) {
      throw new Error(`${sourceLabel}: panel "${panel.title}" appears before any row`)
    }
    currentRow.panels.push({
      id: panel.id,
      title: panel.title,
      targets: (panel.targets ?? []).map((t) => ({
        expr: t.expr,
        datasource: t.datasource ?? {},
      })),
    })
  }

  return { rows }
}

export function extractDashboardModel(dashboardJsonPath) {
  const dashboard = JSON.parse(readFileSync(dashboardJsonPath, 'utf8'))
  return {
    ...buildDashboardModel(dashboard.panels, dashboardJsonPath),
    dashboardUid: dashboard.uid,
  }
}

/** Flat list of every (row, panel) pair, for citation-completeness checks. */
export function flattenPanels(model) {
  const flat = []
  for (const row of model.rows) {
    for (const panel of row.panels) {
      flat.push({ row: row.title, panel: panel.title, id: panel.id, targets: panel.targets })
    }
  }
  return flat
}

/** Every panel target's PromQL expression, with a synthetic file:line label. */
export function flattenTargetExpressions(model, dashboardJsonPath) {
  const exprs = []
  for (const row of model.rows) {
    for (const panel of row.panels) {
      for (const target of panel.targets) {
        if (target.expr) {
          exprs.push({
            expr: target.expr,
            file: dashboardJsonPath,
            line: undefined,
            label: `panel "${panel.title}" (${row.title} row)`,
          })
        }
      }
    }
  }
  return exprs
}
