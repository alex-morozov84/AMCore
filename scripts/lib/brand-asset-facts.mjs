import path from 'node:path'

import { readExternalRegularFile } from './external-file-snapshot.mjs'
import { BRAND_ASSET_PATHS, BRAND_PATHS } from './brand-ownership.mjs'
import { validatePngSnapshot } from './brand-validate.mjs'

const specifications = [
  ['logoDarkSrc', BRAND_PATHS.logoDark],
  ['logoLightSrc', BRAND_PATHS.logoLight],
  ['icon192Src', BRAND_PATHS.icon192, 192, 192],
  ['icon512Src', BRAND_PATHS.icon512, 512, 512],
  ['icon512MaskableSrc', BRAND_PATHS.icon512Maskable, 512, 512],
]

function assetFact(answers, [answerKey, destination, width, height]) {
  const source = answers[answerKey]
  if (!source) return undefined
  if (!BRAND_ASSET_PATHS.includes(destination))
    throw new Error(`unowned brand asset: ${destination}`)
  let snapshot
  try {
    snapshot = readExternalRegularFile(source)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`file not found: ${source}`)
    throw error
  }
  validatePngSnapshot(source, snapshot.bytes, width ? { width, height } : undefined)
  return Object.freeze({
    kind: 'content',
    dimension: 'brand-assets',
    path: destination,
    bytes: Buffer.from(snapshot.bytes),
    mode: snapshot.mode,
    asset: true,
    summary: `copy ${path.basename(source)} -> ${path.basename(destination)}`,
  })
}

export function buildBrandAssetFacts(answers) {
  return specifications.map((specification) => assetFact(answers, specification)).filter(Boolean)
}
