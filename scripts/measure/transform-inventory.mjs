// Static (source-text) classification of every `scripts/lib/project-plan-*.mjs`
// transform module (BACKLOG item 14, PR1 §D). Deliberately a file-level call-site
// *histogram*, not a claim that each fileStep() call is bound to one specific
// helper — a regex scan cannot prove that binding without a real parser, and
// PR1 must not generate false-precision expectations it then treats as truth.
// Where a file's shape can't be attributed unambiguously, it is reported as
// such, not guessed.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const LIB_DIR = path.resolve('scripts/lib')

// operationKind -> [helper call-site tokens that indicate it]. Order matters
// only for readability; counts are independent per token.
const SHAPE_TOKENS = {
  delete: ['deleteFileStep('],
  move: ['moveFileStep('],
  'move-and-rewrite': ['moveAndRewriteStep('],
  'whole-file-legacy-before-after': ['exactContentStep('],
  'owned-sentinel-block': ['removeMarkedBlock('],
  'narrow-exact-text-block': [
    'replaceExactBlock(',
    'removeExactBlock(',
    'replaceAllExactText(',
    'removeMarkdownSection(',
    'trimLocaleRecordLiteral(',
  ],
  'structured-config': [
    'markdownFieldsTransform(',
    'linePatchesTransform(',
    'jsonPatchTransform(',
    'jsonDeleteTransform(',
  ],
  'structural-ast': ['ts-morph', 'Project('],
  copy: ['copyFileStep('],
}

function countOccurrences(source, token) {
  return source.split(token).length - 1
}

function shapeHistogram(source) {
  const histogram = {}
  for (const [kind, tokens] of Object.entries(SHAPE_TOKENS)) {
    const count = tokens.reduce((sum, token) => sum + countOccurrences(source, token), 0)
    if (count > 0) histogram[kind] = count
  }
  return histogram
}

/** Domain-impact tags derived from the module's own filename — a heuristic, not semantic analysis. */
function domainTags(fileName) {
  return {
    docs: /docs|readme|contributing|agents/i.test(fileName),
    tests: /-test\.mjs$|test\b/i.test(fileName),
    ci: /-ci\.mjs$|sentinel/i.test(fileName),
    proxy: /proxy|nginx|caddy/i.test(fileName),
  }
}

/** dimension = the file's own name up to its first `-` after `project-plan-`, a naming-convention heuristic. */
function dimensionFor(fileName) {
  const match = fileName.match(/^project-plan-([a-z0-9]+(?:-[a-z0-9]+)?)/)
  return match ? match[1] : 'unknown'
}

/** Classifies one transform module from its source text. Never executes the module. */
export function classifyModule(fileName, source) {
  const histogram = shapeHistogram(source)
  const shapeCount = Object.keys(histogram).length
  const fileStepCalls = countOccurrences(source, 'fileStep(')
  const attributedFileStepCalls = Object.entries(histogram)
    .filter(([kind]) => kind !== 'delete' && kind !== 'move' && kind !== 'move-and-rewrite')
    .reduce((sum, [, count]) => sum + count, 0)

  return {
    modulePath: `scripts/lib/${fileName}`,
    dimension: dimensionFor(fileName),
    histogram,
    primaryShape: shapeCount === 1 ? Object.keys(histogram)[0] : shapeCount === 0 ? 'other-unclassified' : 'mixed',
    unclassifiedReason:
      fileStepCalls > attributedFileStepCalls
        ? `${fileStepCalls - attributedFileStepCalls} fileStep() call(s) use a transform this scanner cannot attribute to a known helper (custom inline function)`
        : shapeCount === 0
          ? 'no known factory/helper token found in source — needs manual review'
          : null,
    domain: domainTags(fileName),
  }
}

/** Classifies every `project-plan-*.mjs` module in `scripts/lib/`. Read-only. */
export function buildTransformInventory() {
  const files = readdirSync(LIB_DIR)
    .filter((name) => /^project-plan-.*\.mjs$/.test(name) && !name.endsWith('.test.mjs'))
    .sort()
  return files.map((fileName) => classifyModule(fileName, readFileSync(path.join(LIB_DIR, fileName), 'utf8')))
}
