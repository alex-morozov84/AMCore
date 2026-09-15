import { createTransactionFixture, writeFixture } from './filesystem-transaction-test-helpers.mjs'
import { git } from './test-fixture.mjs'

function initializeRepo(root) {
  writeFixture(root, 'first.txt', 'before-one\n', 0o640)
  writeFixture(root, 'second.txt', 'before-two\n', 0o600)
  git(root, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['add', '-A'])
  git(root, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ])
}

export function transactionPlan(operations, changed = true) {
  return {
    displaySteps: changed
      ? [
          {
            kind: 'edit',
            target: 'first.txt',
            summary: 'change first',
            before: 'a',
            after: 'b',
            changed,
          },
        ]
      : [],
    operationsForApply: () =>
      operations.map((operation) => ({ ...operation, bytes: Buffer.from(operation.bytes) })),
  }
}

export async function withTransactionRepo(run) {
  const fixture = createTransactionFixture()
  initializeRepo(fixture.root)
  try {
    await run(fixture.root)
  } finally {
    fixture.cleanup()
  }
}
