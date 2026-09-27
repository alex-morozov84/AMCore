import { run } from './stand/process.mjs'
import { root } from './stand/state.mjs'
await run(process.execPath, ['scripts/stand.mjs', 'e2e', '--lane', 'console-real-stack'], { cwd: root })
