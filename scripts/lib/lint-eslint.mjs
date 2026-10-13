import { ESLint } from 'eslint'

/** Use the stable public API so the paired command loads plugins only once. */
export async function runResidual({ cwd, config, files, options, capture }) {
  const fix = options.includes('--fix')
  const engine = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: config,
    fix,
    warnIgnored: !options.includes('--no-warn-ignored'),
  })
  const results = await engine.lintFiles(files)
  if (fix) await ESLint.outputFixes(results)
  const errors = results.reduce((count, result) => count + result.errorCount, 0)
  const warnings = results.reduce((count, result) => count + result.warningCount, 0)
  const threshold = options.find((option) => option.startsWith('--max-warnings='))
  const exceeds = threshold && warnings > Number(threshold.split('=')[1])
  const formatter = await engine.loadFormatter(capture ? 'json' : 'stylish')
  const stdout = await formatter.format(results)
  const stderr = exceeds
    ? `ESLint found ${warnings} warnings; maximum is ${threshold.split('=')[1]}.`
    : ''
  if (!capture && stdout) console.log(stdout)
  if (!capture && stderr) console.error(stderr)
  return { engine: 'eslint', exit: errors || exceeds ? 1 : 0, stdout, stderr }
}
