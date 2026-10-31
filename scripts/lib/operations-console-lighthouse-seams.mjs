// A file's blocks share one operation key so projection composes their removal.
const blocks = [
  ['scripts/lib/lighthouse-plan.mjs', 'CHOICES'],
  ['scripts/lib/lighthouse-plan.mjs', 'OWNER'],
  ['scripts/lib/lighthouse-plan.mjs', 'URL'],
  ['scripts/lib/lighthouse-coverage.mjs', 'COVERAGE'],
  ['scripts/lib/lighthouse.test.mjs', 'OWNER_TEST'],
  ['scripts/lighthouse/page-state.mjs', 'STATE'],
  ['scripts/lighthouse/fixture.mjs', 'FIXTURE'],
  ['scripts/lighthouse/fixture.mjs', 'FIXTURE_ACCESS'],
  ['scripts/lib/lighthouse-command.mjs', 'LOCAL'],
  ['scripts/lighthouse/ci-aggregate.mjs', 'AGGREGATE'],
]
export const operationsConsoleLighthouseSeams = blocks.map(([path, key]) => ({
  id: `console.lighthouse.${key.toLowerCase()}`,
  path,
  kind: 'file',
  cardinality: 'one',
  seamKind: 'owned-block',
  selector: {
    start: `// AMCORE_CONSOLE_LIGHTHOUSE_${key}_START`,
    end: `// AMCORE_CONSOLE_LIGHTHOUSE_${key}_END`,
  },
  detectors: [
    `AMCORE_CONSOLE_LIGHTHOUSE_${key}_START`,
    'console-real-stack',
    'feature-import',
    '__Host-amcore_console_session',
    'web:console-session:v1',
  ],
  disposition: 'remove',
  operationKey: `console.lighthouse.${path}`,
}))
