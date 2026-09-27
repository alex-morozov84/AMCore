import type {
  PlaywrightTestConfig,
  PlaywrightTestOptions,
  PlaywrightWorkerOptions,
} from '@playwright/test'
export interface ManagedTarget {
  id: string
  uuid: string
  purpose: string
  topology: string
  worktree: string
  snapshot: string
  ports: { web: number; api: number; redis: number; tls: number }
  origins: { product: string; console: string; api: string }
  hostnames: { product: string; console: string; api: string }
  caFile?: string
  relay: string
  lane: string
}
export function activeTarget(): ManagedTarget
export function testOptions(): Partial<PlaywrightTestOptions & PlaywrightWorkerOptions>
export function outputPaths(): Pick<PlaywrightTestConfig, 'outputDir' | 'reporter'>
export function guardedExec(service: string, ...args: string[]): string

export function guardedSql(query: string, variables?: Record<string, string | number>): string
