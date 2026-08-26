// init:brand steps for copying a downstream product's own logo/icon files
// into place. Never generated — only validated (existence, extension, and
// for icons, exact pixel dimensions) and copied byte-for-byte.
import path from 'node:path'
import { copyFileStep } from './init-engine.mjs'
import { resolvePaths, resolveIconSpecs } from './brand-config.mjs'
import { validatePngSource } from './brand-validate.mjs'

export function buildAssetSteps(root, answers) {
  const { logoDark, logoLight } = resolvePaths(root)
  const steps = []

  if (answers.logoDarkSrc) {
    validatePngSource(answers.logoDarkSrc)
    steps.push(
      copyFileStep(
        answers.logoDarkSrc,
        logoDark,
        `copy ${path.basename(answers.logoDarkSrc)} -> logo-dark.png`
      )
    )
  }
  if (answers.logoLightSrc) {
    validatePngSource(answers.logoLightSrc)
    steps.push(
      copyFileStep(
        answers.logoLightSrc,
        logoLight,
        `copy ${path.basename(answers.logoLightSrc)} -> logo-light.png`
      )
    )
  }
  for (const spec of resolveIconSpecs(root)) {
    const src = answers[spec.answerKey]
    if (!src) continue
    validatePngSource(src, { width: spec.width, height: spec.height })
    steps.push(
      copyFileStep(src, spec.dest, `copy ${path.basename(src)} -> ${path.basename(spec.dest)}`)
    )
  }
  return steps
}
