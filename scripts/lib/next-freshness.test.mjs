import assert from 'node:assert/strict'
import test from 'node:test'
import { nextFreshness } from './next-freshness.mjs'

const workspace = 'patchedDependencies:\n  next@16.4.5: patches/next@16.4.5.patch\n'
for (const latest of ['16.4.6', '16.5.0', '17.0.0']) {
  test(`manual Next report exposes ${latest} despite automatic-update exclusion`, () => {
    const report = nextFreshness(() => ({ ok: true, out: JSON.stringify(latest) }), workspace).join(
      '\n'
    )
    assert.ok(report.includes(`| 16.4.5 | ${latest} | ${latest} | Different release available`))
    assert.match(report, /Remove the patch only after an official fixed release/)
  })
}
test('unavailable registry is unknown, never up to date', () => {
  const report = nextFreshness(() => ({ ok: false }), workspace).join('\n')
  assert.match(report, /unavailable.*Unknown/)
  assert.doesNotMatch(report, /Matches registry/)
})

test('a newer major does not hide patch/minor releases in the current major', () => {
  const run = (_command, args) => ({
    ok: true,
    out: args[1] === 'next@latest' ? '"17.0.0"' : '["16.4.5", "16.5.0", "16.4.6"]',
  })
  assert.ok(nextFreshness(run, workspace).join('\n').includes('| 16.4.5 | 16.5.0 | 17.0.0 |'))
})
test('current release still retains removal checks; missing registration stays unknown', () => {
  const run = () => ({ ok: true, out: '"16.4.5"' })
  assert.match(
    nextFreshness(run, workspace).join('\n'),
    /Matches registry latest; retain the patch/
  )
  assert.match(nextFreshness(run, '').join('\n'), /unknown.*Unknown/)
})
