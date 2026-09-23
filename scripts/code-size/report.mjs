import path from 'node:path'

import { changedFunctions } from './functions.mjs'
import { stagedFiles } from './git.mjs'

const FUNCTION_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])
const FILE_EXTENSIONS = new Set([...FUNCTION_EXTENSIONS, '.css', '.prisma', '.sql', '.sh'])

function isCodeFile(file) {
  const name = path.basename(file)
  return (
    FILE_EXTENSIONS.has(path.extname(file)) ||
    name.startsWith('Dockerfile') ||
    file.startsWith('.husky/')
  )
}

function lineCount(text) {
  if (!text) return 0
  return text.split('\n').length - Number(text.endsWith('\n'))
}

function marker(lines, limit) {
  return lines >= limit ? ' [review size]' : ''
}

export function renderReport(root) {
  const files = stagedFiles(root).filter(({ path }) => isCodeFile(path))
  if (files.length === 0) return 'size report: no staged code files'
  const output = ['size report (staged code; advisory):']
  for (const file of files) {
    const lines = lineCount(file.source)
    output.push(`  ${file.path}: ${lines} lines${marker(lines, 150)}`)
    if (!FUNCTION_EXTENSIONS.has(path.extname(file.path))) continue
    for (const item of changedFunctions(file.path, file.source, file.ranges, file.added)) {
      output.push(`    ${item.name} @ ${item.line}: ${item.lines} lines${marker(item.lines, 30)}`)
    }
  }
  return output.join('\n')
}
