import type { z } from 'zod'

// Ctx type of the `.superRefine` callback, extracted structurally so it stays
// correct across zod minor releases without importing an internal type name.
// Shared by the domain rule modules.
export type RefinementCtx = Parameters<Parameters<z.ZodType['superRefine']>[0]>[1]
