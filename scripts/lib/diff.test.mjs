import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { unifiedDiff } from './diff.mjs'

describe('unifiedDiff', () => {
  test('returns empty string for identical content', () => {
    assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '')
  })

  test('renders context, removed, and added lines with a correct hunk header', () => {
    const out = unifiedDiff('a\nb\nc\n', 'a\nx\nc\n', { fromLabel: 'f', toLabel: 'f' })
    assert.match(out, /^--- f$/m)
    assert.match(out, /^\+\+\+ f$/m)
    // `.split('\n')` on a trailing-newline string yields a trailing '' element,
    // counted as one more (unchanged) context line by both sides.
    assert.match(out, /^@@ -1,4 \+1,4 @@$/m)
    assert.match(out, /^ a$/m)
    assert.match(out, /^-b$/m)
    assert.match(out, /^\+x$/m)
    assert.match(out, /^ c$/m)
  })

  test('handles a pure insertion (no removed lines)', () => {
    const out = unifiedDiff('a\nb\n', 'a\nnew\nb\n')
    assert.match(out, /^\+new$/m)
    assert.doesNotMatch(
      out,
      /^-[^-]/m,
      'no removed-content line (the "--- " header itself is not one)'
    )
  })

  test('handles a pure deletion (no added lines)', () => {
    const out = unifiedDiff('a\nold\nb\n', 'a\nb\n')
    assert.match(out, /^-old$/m)
    assert.doesNotMatch(out, /^\+[^+]/m)
  })

  test('regression: collapses distant unchanged context into separate hunks instead of one whole-file hunk', () => {
    // Caught by a live smoke test: a 3-line change to a 99-line file printed
    // ~96 lines of pure context as one giant hunk (~30KB for a tiny edit).
    const unchanged = Array.from({ length: 30 }, (_, i) => `line ${i}`)
    const before = unchanged.join('\n')
    const after = [...unchanged.slice(0, 5), 'changed', ...unchanged.slice(6)].join('\n')

    const out = unifiedDiff(before, after, { contextLines: 3 })
    const hunkHeaders = out.match(/^@@ .* @@$/gm)

    assert.equal(hunkHeaders?.length, 1, 'a single localized change is a single hunk')
    // The far side of the file (e.g. "line 25") must not appear — only the
    // change plus its 3 lines of context on each side.
    assert.doesNotMatch(out, /line 25/)
    assert.match(out, /^-line 5$/m)
    assert.match(out, /^\+changed$/m)
  })

  test('regression: two changes far apart in the same file produce two separate hunks', () => {
    const unchanged = Array.from({ length: 40 }, (_, i) => `line ${i}`)
    const lines = [...unchanged]
    lines[2] = 'changed-near-top'
    lines[35] = 'changed-near-bottom'
    const before = unchanged.join('\n')
    const after = lines.join('\n')

    const out = unifiedDiff(before, after, { contextLines: 3 })
    const hunkHeaders = out.match(/^@@ .* @@$/gm)

    assert.equal(hunkHeaders?.length, 2)
    assert.doesNotMatch(out, /line 15/, 'the untouched middle of the file is not printed')
  })
})
