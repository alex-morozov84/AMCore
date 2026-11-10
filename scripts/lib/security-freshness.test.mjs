import assert from 'node:assert/strict'
import test from 'node:test'
import { securityFreshness } from './security-freshness.mjs'

const ok = (value) => ({ ok: true, out: JSON.stringify(value) })

test('unavailable APIs stay unknown instead of reporting zero alerts', () => {
  const report = securityFreshness(() => ({ ok: false }), 'owner/repo').join('\n')
  assert.match(report, /Alerts unavailable/)
  assert.match(report, /Code scanning unavailable/)
  assert.doesNotMatch(report, /No open/)
})

test('reports exact installed parent, latest requirement, absent fix and image provenance', () => {
  const dependency = (number, name, fixed) => ({
    number,
    html_url: `https://example.com/${number}`,
    dependency: { package: { name }, version_requirement: '1.0.0' },
    security_vulnerability: { first_patched_version: fixed && { identifier: fixed } },
  })
  const run = (command, args) => {
    if (command === 'gh')
      return args.at(-1).includes('/dependabot/')
        ? ok([[dependency(1, 'lib', '2.0.0')], [dependency(2, 'other', null)]])
        : ok([
            [
              {
                number: 3,
                html_url: 'https://example.com/3',
                most_recent_instance: {
                  category: 'trivy-image-migrator',
                  commit_sha: 'abc',
                  message: { text: 'apt\nFixed Version: 3.0.4' },
                },
              },
            ],
          ])
    if (args.includes('why'))
      return ok([{ version: '1.0.0', dependents: [{ name: '@scope/parent', version: '4.0.0' }] }])
    assert.equal(args[1], '@scope/parent@latest')
    return ok({ version: '4.1.0', dependencies: { lib: '^1.0.0' } })
  }
  const report = securityFreshness(run, 'owner/repo').join('\n')
  assert.match(report, /@scope\/parent@4.0.0; latest 4.1.0; requires lib \^1.0.0/)
  assert.match(report, /No patched release listed/)
  assert.match(report, /trivy-image-migrator \/ abc/)
  assert.match(report, /rebuild and scan the actual image/)
  assert.match(report, /Needs investigation/)
})

test('missing checkout version cannot claim a known blocking parent', () => {
  const run = (command, args) =>
    command === 'pnpm'
      ? ok([])
      : args.at(-1).includes('/dependabot/')
        ? ok([[{ number: 1, dependency: { package: { name: 'lib' }, version_requirement: '1' } }]])
        : ok([[]])
  assert.match(securityFreshness(run, 'owner/repo').join('\n'), /alert version absent/)
})
