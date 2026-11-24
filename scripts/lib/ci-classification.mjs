import { isDeepStrictEqual } from 'node:util'
import { normalizeCiAreas } from './ci-selection.mjs'

export function classifyCiChange(acquired, filterOutputs) {
  let areas = {}
  const classifierChanged = acquired.changedFiles.some((file) =>
    /^(?:\.github\/(?:ci-paths\.yml|workflows\/|actions\/)|scripts\/(?:lib\/)?ci-)/.test(file)
  )
  let diffComplete = acquired.diffComplete && !classifierChanged
  if (diffComplete) {
    try {
      const outputs = JSON.parse(filterOutputs)
      const all = JSON.parse(outputs.all_files ?? '[]')
      diffComplete = isDeepStrictEqual([...all].sort(), acquired.changedFiles)
      if (diffComplete) areas = normalizeCiAreas(outputs)
    } catch {
      diffComplete = false
    }
  }
  return { areas, diffComplete }
}
