import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SHARED_SEARCH_FILES = [
  'apps/web/src/shared/lib/debounced-draft-state.ts',
  'apps/web/src/shared/lib/use-debounced-draft.ts',
  'apps/web/src/shared/lib/use-debounced-draft.echoes.test.ts',
  'apps/web/src/shared/lib/use-debounced-draft.races.test.ts',
  'apps/web/src/shared/lib/use-debounced-draft.test.ts',
  'apps/web/src/shared/ui/search-field.stories.tsx',
  'apps/web/src/shared/ui/search-field.test.tsx',
  'apps/web/src/shared/ui/search-field.tsx',
]

export function assertSharedSearchRetained(root, { storybook = true } = {}) {
  for (const rel of SHARED_SEARCH_FILES) {
    const expected = storybook || !rel.endsWith('.stories.tsx')
    assert.equal(existsSync(path.join(root, rel)), expected, rel)
    if (expected) {
      assert.equal(readFileSync(path.join(root, rel), 'utf8').includes('console-discovery'), false)
    }
  }
}
