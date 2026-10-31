import test from 'node:test'
import assert from 'node:assert/strict'
import { browserSandboxProfile } from '../lighthouse/browser-sandbox.mjs'

test('CI sandbox admission names only the exact pinned Chrome executable', () => {
  const path = '/home/runner/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome'
  assert.equal(
    browserSandboxProfile(path),
    `abi <abi/4.0>,\ninclude <tunables/global>\nprofile amcore-lighthouse "${path}" flags=(unconfined) {\n  userns,\n}\n`
  )
  for (const invalid of [
    path.replace('156.0.8078.47', '155.0.0.0'),
    path.replace('/runner/', '/runner/../'),
    path.replace('/runner/', '/*/'),
    `${path}\nother-profile { userns, }`,
    '/opt/google/chrome/chrome',
  ])
    assert.throws(() => browserSandboxProfile(invalid), /invalid-browser-sandbox-path/)
})
