import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateInventory, validateSarif, withFixableOnly } from './lib/migrator-report.mjs'

const [image, inventory = 'migrator-vuln-inventory.json', sarif = 'migrator-trivy-results.sarif'] =
  process.argv.slice(2)
if (!image) throw new Error('Usage: node scripts/scan-migrator-image.mjs IMAGE [INVENTORY SARIF]')
const imageId = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
  encoding: 'utf8',
}).trim()
const temporary = mkdtempSync(join(tmpdir(), 'amcore-migrator-report-'))
try {
  const freshInventory = join(temporary, 'inventory.json')
  const fixableInventory = join(temporary, 'fixable-inventory.json')
  const freshSarif = join(temporary, 'report.sarif')
  execFileSync(
    'trivy',
    [
      'image',
      '--scanners',
      'vuln',
      '--list-all-pkgs',
      '--format',
      'json',
      '--output',
      freshInventory,
      '--exit-code',
      '0',
      image,
    ],
    { stdio: 'inherit' }
  )
  const report = JSON.parse(readFileSync(freshInventory, 'utf8'))
  validateInventory(report, imageId)
  // The Security tab gets only findings with a fix; the full inventory keeps the rest.
  writeFileSync(fixableInventory, JSON.stringify(withFixableOnly(report)))
  execFileSync(
    'trivy',
    [
      'convert',
      '--format',
      'sarif',
      '--severity',
      'HIGH,CRITICAL',
      '--output',
      freshSarif,
      fixableInventory,
    ],
    { stdio: 'inherit' }
  )
  validateSarif(JSON.parse(readFileSync(freshSarif, 'utf8')), report)
  copyFileSync(freshInventory, inventory)
  copyFileSync(freshSarif, sarif)
  console.log(`Migrator vulnerability reports validated for ${imageId}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
