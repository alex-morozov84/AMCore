import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { classifyModule, buildTransformInventory } from './transform-inventory.mjs'

describe('transform-inventory: classifyModule (synthetic sources — independent oracle)', () => {
  test('a pure exactContentStep module classifies as whole-file-legacy-before-after', () => {
    const source = `import { exactContentStep } from './init-engine.mjs'\nexactContentStep(p, { expectedBefore, after }, 'x')\n`
    const result = classifyModule('project-plan-demo-x.mjs', source)
    assert.equal(result.primaryShape, 'whole-file-legacy-before-after')
    assert.equal(result.unclassifiedReason, null)
  })

  test('a module using removeMarkedBlock classifies as owned-sentinel-block', () => {
    const source = `fileStep(p, (c) => removeMarkedBlock(c, 'X'), 's')\n`
    const result = classifyModule('project-plan-demo-y.mjs', source)
    assert.equal(result.primaryShape, 'owned-sentinel-block')
  })

  test('a module using only jsonPatchTransform classifies as structured-config', () => {
    const source = `fileStep(p, jsonPatchTransform({ a: 1 }), 's')\n`
    assert.equal(classifyModule('project-plan-demo-z.mjs', source).primaryShape, 'structured-config')
  })

  test('a module with no known token is other-unclassified, with a reason', () => {
    const result = classifyModule('project-plan-demo-w.mjs', 'export const nothing = 1\n')
    assert.equal(result.primaryShape, 'other-unclassified')
    assert.match(result.unclassifiedReason, /no known factory/)
  })

  test('a fileStep call with no attributable helper is flagged, not silently guessed', () => {
    const source = `fileStep(p, (c) => c.replace('a', 'b'), 's')\n`
    const result = classifyModule('project-plan-demo-v.mjs', source)
    assert.match(result.unclassifiedReason, /cannot attribute/)
  })

  test('two distinct shapes in one file classify as mixed', () => {
    const source = `deleteFileStep(p, 's')\nmoveFileStep(a, b, 's')\n`
    assert.equal(classifyModule('project-plan-demo-u.mjs', source).primaryShape, 'mixed')
  })

  test('dimension is derived from the filename prefix', () => {
    assert.equal(classifyModule('project-plan-storybook-docs-readme.mjs', '').dimension, 'storybook-docs')
  })
})

describe('transform-inventory: buildTransformInventory (real repo, ground truth)', () => {
  const inventory = buildTransformInventory()

  test('classifies every real module (no silent skips)', () => {
    assert.equal(inventory.length, 69)
    for (const module of inventory) {
      assert.ok(module.primaryShape, `${module.modulePath} has no primaryShape`)
      if (module.primaryShape === 'other-unclassified') {
        assert.ok(module.unclassifiedReason, `${module.modulePath} is unclassified with no reason`)
      }
    }
  })

  test('a known whole-file-copy module (project-plan-web-nav-oauth.mjs) is classified as such', () => {
    const found = inventory.find((m) => m.modulePath.endsWith('project-plan-web-nav-oauth.mjs'))
    assert.ok(found, 'module not found — has it been renamed?')
    assert.equal(found.primaryShape, 'whole-file-legacy-before-after')
  })

  test('the storybook CI sentinel transform is actually narrow-exact-text-block, not owned-sentinel-block', () => {
    // Real finding: project-plan-storybook-ci.mjs embeds the whole CI job as a
    // literal removeExactBlock() target — the amcore:sentinel-block comments
    // inside that literal are delimiters within the copy, not a
    // removeMarkedBlock()-style scan. See PR1's implementation report.
    const found = inventory.find((m) => m.modulePath.endsWith('project-plan-storybook-ci.mjs'))
    assert.ok(found)
    assert.equal(found.primaryShape, 'narrow-exact-text-block')
  })

  test('output is deterministically ordered by module path', () => {
    const paths = inventory.map((m) => m.modulePath)
    assert.deepEqual(paths, [...paths].sort())
  })
})
