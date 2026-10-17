import assert from 'node:assert/strict'

export function validateInventory(report, imageId) {
  assert.equal(report.SchemaVersion, 2, 'Unsupported Trivy inventory schema')
  assert.equal(report.ArtifactType, 'container_image', 'Expected a container image scan')
  assert.equal(report.Metadata?.ImageID, imageId, 'Trivy inventory belongs to another image')
  assert.ok(Array.isArray(report.Results) && report.Results.length, 'Missing Trivy results')
  assert.ok(
    report.Results.some((result) => result.Packages?.some((pkg) => pkg.Name === 'prisma')),
    'Prisma CLI missing from scanner inventory'
  )
  for (const result of report.Results)
    assert.equal(
      result.Secrets,
      undefined,
      'Migrator inventory must be separate from runner secrets scan'
    )
}

export function validateSarif(report, inventory) {
  const actual = new Set()
  assert.equal(report.version, '2.1.0', 'Unsupported SARIF version')
  assert.ok(Array.isArray(report.runs) && report.runs.length, 'Missing SARIF runs')
  for (const run of report.runs) {
    assert.equal(run.tool?.driver?.name, 'Trivy', 'Expected Trivy SARIF driver')
    assert.ok(Array.isArray(run.tool.driver.rules), 'Missing SARIF rules')
    assert.ok(Array.isArray(run.results), 'Missing SARIF results')
    for (const result of run.results) {
      assert.ok(
        result.ruleId && run.tool.driver.rules.some((rule) => rule.id === result.ruleId),
        'Unknown SARIF rule'
      )
      assert.ok(result.message?.text && result.locations?.length, 'Incomplete SARIF result')
      const name = /^Package: (.+)$/m.exec(result.message.text)?.[1]
      const version = /^Installed Version: (.+)$/m.exec(result.message.text)?.[1]
      const severity = /^Severity: (.+)$/m.exec(result.message.text)?.[1]
      assert.ok(name && version && severity, 'Missing SARIF package identity')
      actual.add(JSON.stringify([result.ruleId, name, version, severity]))
    }
  }
  // Trivy shares rules across packages and can combine repeated locations.
  // Compare distinct advisory/package/version/severity identities, not raw counts.
  const expected = new Set(
    inventory.Results.flatMap((result) => result.Vulnerabilities ?? [])
      .filter((vuln) => ['HIGH', 'CRITICAL'].includes(vuln.Severity))
      .map((vuln) =>
        JSON.stringify([vuln.VulnerabilityID, vuln.PkgName, vuln.InstalledVersion, vuln.Severity])
      )
  )
  assert.deepEqual(actual, expected, 'SARIF findings differ from HIGH/CRITICAL inventory')
}
