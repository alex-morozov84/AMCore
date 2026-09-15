import { applyFilesystemTransaction } from './filesystem-transaction.mjs'

const [root, crashPoint] = process.argv.slice(2)
const kill = () => process.kill(process.pid, 'SIGKILL')

applyFilesystemTransaction({
  root,
  operations: [{ kind: 'write', target: 'target', bytes: Buffer.from('mutated') }],
  hooks: {
    ...(crashPoint === 'journal' ? { afterJournalPublished: kill } : {}),
    ...(crashPoint === 'mutation' ? { afterMutation: kill } : {}),
  },
})
