import { Action, ApiKeyScopeErrorCode, Subject, createApiKeySchema } from '@amcore/shared'
import { z } from 'zod'

// AK-05 schema validation tests.
//
// The Cartesian product of `Action × Subject` minus `manage:all` is the
// scope registry. These tests live in the API workspace (not in
// `packages/shared`) to avoid adding a test runner to the shared
// package; the schema is imported through `@amcore/shared`'s public API
// the same way the API DTO and the frontend form do.

const VALID_PAYLOAD = {
  name: 'test',
  organizationId: 'cmp00000000000000000000000',
  scopes: ['read:User'],
}

function expectScopeError(input: string, expectedCode: ApiKeyScopeErrorCode) {
  const result = createApiKeySchema.safeParse({ ...VALID_PAYLOAD, scopes: [input] })
  expect(result.success).toBe(false)
  if (result.success) return
  const issue = result.error.issues.find((i) => i.path.join('.') === 'scopes.0') as z.ZodIssue & {
    params?: { errorCode?: string }
  }
  expect(issue).toBeDefined()
  expect(issue.params?.errorCode).toBe(expectedCode)
}

describe('createApiKeySchema (AK-05: scope validation)', () => {
  describe('valid scopes', () => {
    // Data-driven: every (action, subject) pair in the registry must
    // pass — except manage:all which has its own forbidden test below.
    const allActions = Object.values(Action)
    const allSubjects = Object.values(Subject)

    test.each(
      allActions.flatMap((action) =>
        allSubjects
          .map((subject) => [action, subject, `${action}:${subject}`] as const)
          .filter(([, , scope]) => scope !== `${Action.Manage}:${Subject.All}`)
      )
    )('accepts %s:%s', (_action, _subject, scope) => {
      const result = createApiKeySchema.safeParse({ ...VALID_PAYLOAD, scopes: [scope] })
      expect(result.success).toBe(true)
    })

    it('accepts multiple valid scopes in one array', () => {
      const result = createApiKeySchema.safeParse({
        ...VALID_PAYLOAD,
        scopes: ['read:User', 'manage:Organization', 'read:all'],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('forbidden manage:all', () => {
    it('rejects manage:all with API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN', () => {
      expectScopeError('manage:all', ApiKeyScopeErrorCode.API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN)
    })
  })

  describe('unknown action', () => {
    it('rejects user:read (old non-canonical format)', () => {
      expectScopeError('user:read', ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_ACTION)
    })

    it('rejects xxx:User', () => {
      expectScopeError('xxx:User', ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_ACTION)
    })
  })

  describe('unknown subject', () => {
    it('rejects read:NonExistent', () => {
      expectScopeError('read:NonExistent', ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_SUBJECT)
    })

    it('rejects read:user (lowercase subject is not canonical)', () => {
      // Subject.User is PascalCase 'User'; 'user' is not in the registry.
      expectScopeError('read:user', ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_SUBJECT)
    })
  })

  describe('malformed', () => {
    it('rejects empty string', () => {
      expectScopeError('', ApiKeyScopeErrorCode.API_KEY_SCOPE_INVALID_FORMAT)
    })

    it('rejects read (no colon)', () => {
      expectScopeError('read', ApiKeyScopeErrorCode.API_KEY_SCOPE_INVALID_FORMAT)
    })

    it('rejects read:User:extra (too many parts)', () => {
      expectScopeError('read:User:extra', ApiKeyScopeErrorCode.API_KEY_SCOPE_INVALID_FORMAT)
    })

    it('rejects :User (empty action)', () => {
      expectScopeError(':User', ApiKeyScopeErrorCode.API_KEY_SCOPE_INVALID_FORMAT)
    })

    it('rejects read: (empty subject)', () => {
      expectScopeError('read:', ApiKeyScopeErrorCode.API_KEY_SCOPE_INVALID_FORMAT)
    })

    it('rejects leading/trailing whitespace (no trim)', () => {
      // ' read:User ' splits to [' read', 'User '] — ' read' is unknown action.
      expectScopeError(' read:User ', ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_ACTION)
    })
  })

  describe('multi-scope error paths', () => {
    it('reports per-index path on the bad element only', () => {
      const result = createApiKeySchema.safeParse({
        ...VALID_PAYLOAD,
        scopes: ['read:User', 'manage:all', 'read:Organization'],
      })
      expect(result.success).toBe(false)
      if (result.success) return

      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'scopes.1'
      ) as z.ZodIssue & { params?: { errorCode?: string } }
      expect(issue).toBeDefined()
      expect(issue.params?.errorCode).toBe(ApiKeyScopeErrorCode.API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN)

      const goodIssue = result.error.issues.find(
        (i) => i.path.join('.') === 'scopes.0' || i.path.join('.') === 'scopes.2'
      )
      expect(goodIssue).toBeUndefined()
    })
  })

  describe('empty scopes array', () => {
    it('rejects empty scopes array (min(1))', () => {
      const result = createApiKeySchema.safeParse({ ...VALID_PAYLOAD, scopes: [] })
      expect(result.success).toBe(false)
    })
  })
})
