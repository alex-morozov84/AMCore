import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const script = new URL('../scan-migrator-image.mjs', import.meta.url).pathname
const image = {
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
}
const sarif = {
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
}

function runFixture(mode) {
  const directory = mkdtempSync(join(tmpdir(), 'amcore-migrator-scan-'))
  try {
    writeFileSync(join(directory, 'inventory.json'), JSON.stringify(image))
    writeFileSync(join(directory, 'report.sarif'), JSON.stringify(sarif))
    writeFileSync(join(directory, 'docker'), '#!/bin/sh\necho fixture-image\n', { mode: 0o755 })
    writeFileSync(
      join(directory, 'trivy'),
      `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.FIXTURE_MODE === 'operational') process.exit(42);
if (process.env.FIXTURE_MODE !== 'missing') {
  const data = args[0] === 'image' ? ${JSON.stringify(image)} : ${JSON.stringify(sarif)};
  if (args[0] === 'convert' && process.env.FIXTURE_MODE === 'missing-sarif') process.exit(0);
  if (args[0] === 'convert' && process.env.FIXTURE_MODE === 'lost-finding') data.runs[0].results = [];
  if (process.env.FIXTURE_MODE === 'wrong-image' && data.Metadata) data.Metadata.ImageID = 'other-image';
  if (process.env.FIXTURE_MODE === 'unfixed' && data.Metadata)
    data.Results[0].Vulnerabilities.push({ VulnerabilityID: 'unfixed-advisory', PkgName: 'zlib1g', InstalledVersion: '1.2.13', Severity: 'HIGH' });
  writeFileSync(args[args.indexOf('--output') + 1], process.env.FIXTURE_MODE === 'malformed' ? '{broken' : JSON.stringify(data));
}
`,
      { mode: 0o755 }
    )
    return spawnSync(
      process.execPath,
      [script, 'fixture:latest', 'inventory.json', 'report.sarif'],
      {
        cwd: directory,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FIXTURE_MODE: mode },
        encoding: 'utf8',
        timeout: 10000,
      }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('actual migrator scan command accepts vulnerability findings', () => {
  const result = runFixture('findings')
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
})

test('actual migrator scan command keeps unfixed findings out of the SARIF check', () => {
  const result = runFixture('unfixed')
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
})

for (const mode of [
  'operational',
  'missing',
  'missing-sarif',
  'lost-finding',
  'malformed',
  'wrong-image',
])
  test(`actual migrator scan command rejects ${mode} reports`, () => {
    const result = runFixture(mode)
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.equal(result.signal, null)
  })
