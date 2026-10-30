import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

import { z } from 'zod'

import { MFA_DEPLOYMENT_CONTRACT, MFA_PROTOCOL_VERSION } from '@amcore/shared'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const mfaArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    contract: z.literal(MFA_DEPLOYMENT_CONTRACT),
    protocol: z.literal(MFA_PROTOCOL_VERSION),
    component: z.enum(['api-worker', 'web']),
    buildId: digest,
    sourceCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    recoveryCommand: z.boolean(),
  })
  .strict()
const fleetSchema = z
  .object({
    instances: z
      .array(
        z
          .object({
            instance: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[A-Za-z0-9_.-]+$/),
            role: z.enum(['api', 'worker', 'all', 'web']),
            image: z
              .string()
              .min(1)
              .max(512)
              .regex(/^\S+@sha256:[a-f0-9]{64}$/),
            artifact: mfaArtifactSchema,
          })
          .strict()
      )
      .min(2)
      .max(100),
  })
  .strict()
export type MfaFleetEvidence = z.infer<typeof fleetSchema>
export interface ValidatedMfaFleetEvidence {
  fleet: MfaFleetEvidence
  evidenceHash: string
  sourceCommit: string
}

/** This validates operator-collected image evidence, not remote liveness, ingress drain or fleet completeness. */
export function validateMfaFleetEvidence(raw: unknown): ValidatedMfaFleetEvidence {
  const fleet = fleetSchema.parse(raw)
  const names = fleet.instances.map((instance) => instance.instance)
  if (new Set(names).size !== names.length) throw new Error('duplicate_instance')
  for (const role of ['api', 'worker', 'web'])
    if (
      !fleet.instances.some(
        (instance) => instance.role === role || (role !== 'web' && instance.role === 'all')
      )
    )
      throw new Error('missing_role')
  const commits = new Set(fleet.instances.map((instance) => instance.artifact.sourceCommit))
  if (commits.size !== 1) throw new Error('mixed_sources')
  for (const instance of fleet.instances) {
    if (
      instance.artifact.component !== (instance.role === 'web' ? 'web' : 'api-worker') ||
      (instance.role !== 'web' && !instance.artifact.recoveryCommand)
    )
      throw new Error('incomplete_capability')
  }
  return {
    fleet,
    evidenceHash: createHash('sha256').update(JSON.stringify(fleet)).digest('hex'),
    sourceCommit: fleet.instances[0]!.artifact.sourceCommit,
  }
}

export async function readMfaFleetEvidence(path: string): Promise<ValidatedMfaFleetEvidence> {
  const info = await stat(path)
  if (!info.isFile() || info.size > 65536) throw new Error('invalid_fleet_file')
  const content = await readFile(path, 'utf8')
  if (Buffer.byteLength(content) > 65536) throw new Error('invalid_fleet_file')
  return validateMfaFleetEvidence(JSON.parse(content))
}
