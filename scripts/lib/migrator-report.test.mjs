import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateInventory, validateSarif, withFixableOnly } from './migrator-report.mjs'

const inventory = () => ({
  SchemaVersion: 2,
  ArtifactType: 'container_image',
  Metadata: { ImageID: 'fixture-image' },
  Results: [
    {
      Packages: [{ Name: 'prisma' }],
      Vulnerabilities: [
        {
          VulnerabilityID: 'fixture-advisory',
          PkgName: 'prisma',
          InstalledVersion: '7.10.1',
          FixedVersion: '7.10.2',
          Severity: 'CRITICAL',
        },
      ],
    },
  ],
})
const sarif = () => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'Trivy', rules: [{ id: 'fixture-advisory' }] } },
      results: [
        {
          ruleId: 'fixture-advisory',
          message: { text: 'Package: prisma\nInstalled Version: 7.10.1\nSeverity: CRITICAL' },
          locations: [{}],
        },
      ],
    },
  ],
})

test('migrator report accepts findings without treating them as scan failure', () => {
  validateInventory(inventory(), 'fixture-image')
  validateSarif(sarif(), inventory())
})

test('migrator report refuses wrong-image and incomplete inventories', () => {
  assert.throws(() => validateInventory(inventory(), 'other-image'), /another image/)
  const data = inventory()
  data.Results = []
  assert.throws(() => validateInventory(data, 'fixture-image'), /Missing Trivy results/)
  assert.throws(() => validateInventory({}, 'fixture-image'), /schema/)
})

test('migrator report refuses malformed and dangling-rule SARIF', () => {
  assert.throws(() => validateSarif({ version: '2.1.0', runs: [] }), /Missing SARIF runs/)
  const data = sarif()
  data.runs[0].results[0].ruleId = 'unknown-rule'
  assert.throws(() => validateSarif(data), /Unknown SARIF rule/)
  assert.throws(() => JSON.parse('{broken-report'), SyntaxError)
})

test('SARIF refuses lost findings and permits empty results only for empty selection', () => {
  const empty = sarif()
  empty.runs[0].results = []
  assert.throws(() => validateSarif(empty, inventory()), /findings differ/)
  const clean = inventory()
  clean.Results[0].Vulnerabilities = [{ Severity: 'LOW' }]
  validateSarif(empty, clean)
})

test('unfixed findings stay in the inventory but are neither expected nor allowed in SARIF', () => {
  const data = inventory()
  data.Results[0].Vulnerabilities.push({
    VulnerabilityID: 'unfixed-advisory',
    PkgName: 'zlib1g',
    InstalledVersion: '1.2.13',
    Severity: 'HIGH',
  })
  validateSarif(sarif(), data)
  const leaked = sarif()
  leaked.runs[0].tool.driver.rules.push({ id: 'unfixed-advisory' })
  leaked.runs[0].results.push({
    ruleId: 'unfixed-advisory',
    message: { text: 'Package: zlib1g\nInstalled Version: 1.2.13\nSeverity: HIGH' },
    locations: [{}],
  })
  assert.throws(() => validateSarif(leaked, data), /findings differ/)
})

test('withFixableOnly keeps fixable HIGH/CRITICAL findings and leaves the input untouched', () => {
  const data = inventory()
  data.Results[0].Vulnerabilities.push(
    { VulnerabilityID: 'no-fix', Severity: 'CRITICAL', FixedVersion: '' },
    { VulnerabilityID: 'low-fixed', Severity: 'LOW', FixedVersion: '1.0.1' }
  )
  data.Results.push({ Packages: [{ Name: 'plain' }] })
  const filtered = withFixableOnly(data)
  assert.deepEqual(
    filtered.Results[0].Vulnerabilities.map((vuln) => vuln.VulnerabilityID),
    ['fixture-advisory']
  )
  assert.equal(filtered.Results[1].Vulnerabilities, undefined)
  assert.equal(data.Results[0].Vulnerabilities.length, 3)
  validateSarif(sarif(), filtered)
})

test('SARIF covers repeated findings without raw count equality', () => {
  const repeated = inventory()
  repeated.Results[0].Vulnerabilities.push({ ...repeated.Results[0].Vulnerabilities[0] })
  validateSarif(sarif(), repeated)
  repeated.Results[0].Vulnerabilities.push({
    ...repeated.Results[0].Vulnerabilities[0],
    PkgName: 'other-package',
  })
  assert.throws(() => validateSarif(sarif(), repeated), /findings differ/)
})
