// AMCore observability contract — shared extraction of Prometheus rule files
// (alert + recording rules) with source line numbers, so every guard reports
// a real file:line rather than "somewhere in this YAML."
import { readFileSync } from 'node:fs'
import { LineCounter, parseDocument } from 'yaml'

function parseWithLines(filePath) {
  const text = readFileSync(filePath, 'utf8')
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter, keepSourceTokens: true })
  return { doc, lineCounter, text }
}

function lineOf(lineCounter, node) {
  if (!node || !node.range) return undefined
  return lineCounter.linePos(node.range[0]).line
}

/**
 * Flattens a Prometheus rule file (`groups: [{ name, rules: [...] }]`) into
 * alerting rules and recording rules, each carrying its source file:line.
 */
export function extractRuleFile(filePath) {
  const { doc, lineCounter } = parseWithLines(filePath)
  const groups = doc.get('groups', false) ?? []
  const alertingRules = []
  const recordingRules = []
  const groupNames = []

  for (let g = 0; g < groups.items.length; g++) {
    const groupName = doc.getIn(['groups', g, 'name'])
    groupNames.push(groupName)
    const rules = doc.getIn(['groups', g, 'rules'], false) ?? { items: [] }
    for (let r = 0; r < rules.items.length; r++) {
      const alertName = doc.getIn(['groups', g, 'rules', r, 'alert'])
      const recordName = doc.getIn(['groups', g, 'rules', r, 'record'])
      const exprNode = doc.getIn(['groups', g, 'rules', r, 'expr'], true)
      const expr = exprNode?.value ?? doc.getIn(['groups', g, 'rules', r, 'expr'])
      const line = lineOf(lineCounter, exprNode)
      const runbookPath = doc.getIn(['groups', g, 'rules', r, 'annotations', 'runbook_path'])

      if (alertName) {
        alertingRules.push({ alertName, expr, file: filePath, line, groupName, runbookPath })
      } else if (recordName) {
        recordingRules.push({ recordName, expr, file: filePath, line, groupName })
      }
    }
  }

  return { groupNames, alertingRules, recordingRules }
}

/** Merges `extractRuleFile` results across multiple rule files. */
export function extractRuleFiles(filePaths) {
  const merged = { groupNames: [], alertingRules: [], recordingRules: [] }
  for (const filePath of filePaths) {
    const one = extractRuleFile(filePath)
    merged.groupNames.push(...one.groupNames)
    merged.alertingRules.push(...one.alertingRules)
    merged.recordingRules.push(...one.recordingRules)
  }
  return merged
}
