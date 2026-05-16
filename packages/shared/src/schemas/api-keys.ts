import { z } from 'zod'

import { ApiKeyScopeErrorCode } from '../constants'
import { Action, Subject } from '../enums/permissions'

// Allowed scope grammar (AK-05).
//
// A scope is exactly `action:Subject`, where `action` is a value of the
// `Action` enum and `Subject` is a value of the `Subject` enum. The
// Cartesian product is implicitly the registry — adding a new Subject
// (e.g. `Workout` when the fitness module lands) extends the allow-list
// automatically without any registry plumbing.
//
// `manage:all` is explicitly forbidden: it has no narrowing effect and
// would make the api-key JWT-equivalent, defeating the least-privilege
// intent of issuing a scoped key. Owners who need full power should use
// their JWT. Stage 4's drop in `AbilityFactory.applyScopes()` is kept as
// defense-in-depth for seed/migration/bypass scenarios, but this schema
// is the primary line of validation.
//
// Wildcards `read:all`, `manage:User`, etc. ARE allowed — they intersect
// correctly with owner permissions in Stage 4's lattice algorithm.
//
// Strict matching: no trim, no normalization. `' read:User '` is rejected.
// `parse, don't validate` — canonical input only.

const ACTIONS = Object.values(Action) as readonly string[]
const SUBJECTS = Object.values(Subject) as readonly string[]

const scopeSchema = z.string().superRefine((value, ctx) => {
  const parts = value.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Scope must be in `action:Subject` format',
      params: { errorCode: ApiKeyScopeErrorCode.API_KEY_SCOPE_INVALID_FORMAT },
    })
    return
  }
  const [action, subject] = parts
  if (!ACTIONS.includes(action)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Unknown scope action',
      params: { errorCode: ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_ACTION },
    })
    return
  }
  if (!SUBJECTS.includes(subject)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Unknown scope subject',
      params: { errorCode: ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_SUBJECT },
    })
    return
  }
  if (action === Action.Manage && subject === Subject.All) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`manage:all` is forbidden — would grant unrestricted access',
      params: { errorCode: ApiKeyScopeErrorCode.API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN },
    })
  }
})

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  organizationId: z.string().cuid(),
  scopes: z.array(scopeSchema).min(1),
  expiresAt: z.string().datetime().optional(),
})

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
