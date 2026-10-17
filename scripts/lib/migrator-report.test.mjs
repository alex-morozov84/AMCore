import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateInventory, validateSarif } from './migrator-report.mjs'

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

test('SARIF covers repeated and unfixed findings without raw count equality', () => {
  const repeated = inventory()
  repeated.Results[0].Vulnerabilities.push({ ...repeated.Results[0].Vulnerabilities[0] })
  validateSarif(sarif(), repeated)
  repeated.Results[0].Vulnerabilities.push({
    ...repeated.Results[0].Vulnerabilities[0],
    PkgName: 'other-package',
  })
  assert.throws(() => validateSarif(sarif(), repeated), /findings differ/)
})
