import { execFile, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { activeTarget } from './managed-target.mjs'

interface ProofEvent {
  event: string
  key: string
  revision?: number
  intervalSeconds?: number
  processRole?: string
  instanceId?: string
}
export interface ProcessObservation {
  process: string
  events: ProofEvent[]
}
const script = resolve(process.cwd(), '../../scripts/stand/runtime-settings-proof.mjs')
function options() {
  activeTarget()
  return {
    encoding: 'utf8' as const,
    env: {
      NODE_ENV: 'test' as const,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
      AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
    },
  }
}
export function settingsProof(
  action: 'start' | 'stop' | 'observations' | 'restart-worker' | 'pause-redis'
): string {
  return execFileSync(process.execPath, [script, action], options()).trim()
}
export function processObservations(): ProcessObservation[] {
  return JSON.parse(settingsProof('observations')) as ProcessObservation[]
}
export function blockSettingsReads(): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(process.execPath, [script, 'block-reads'], options(), (error) =>
      error ? reject(error) : resolve()
    )
  )
}
