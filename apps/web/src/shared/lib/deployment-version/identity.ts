import { z } from 'zod'

export const DEPLOYMENT_VERSION = process.env.NEXT_PUBLIC_DEPLOYMENT_VERSION ?? ''

export const deploymentVersionResponseSchema = z.object({
  version: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9._-]+$/),
})
