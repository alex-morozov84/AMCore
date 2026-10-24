import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger'

export function assertLoginDiagnosticsContract(document: OpenAPIObject): void {
  const resolve = (value: unknown): SchemaObject => {
    const schema = value as { $ref?: string }
    return (
      schema?.$ref ? document.components?.schemas?.[schema.$ref.split('/').at(-1)!] : value
    ) as SchemaObject
  }
  const operation = document.paths['/admin/users/{id}']!.get!
  expect(operation.security).toEqual([{ bearer: [] }])
  const success = operation.responses!['200'] as {
    content?: { 'application/json'?: { schema?: unknown } }
  }
  const detail = resolve(success.content?.['application/json']?.schema)
  expect(detail.required).toContain('loginDiagnostics')
  const facts = resolve(detail.properties!.loginDiagnostics)
  expect(Object.keys(facts.properties!).sort()).toEqual(['hasPassword', 'linkedProviders'])
  expect(facts.required).toEqual(expect.arrayContaining(['hasPassword', 'linkedProviders']))
  expect(facts.additionalProperties).toBe(false)
  expect(resolve(facts.properties!.hasPassword).type).toBe('boolean')
  const providers = resolve(facts.properties!.linkedProviders)
  expect(providers.maxItems).toBe(4)
  expect(resolve((providers as SchemaObject & { items: unknown }).items).enum).toEqual([
    'google',
    'github',
    'apple',
    'telegram',
  ])
  expect(JSON.stringify(facts)).not.toMatch(
    /passwordHash|providerAccountId|accessToken|refreshToken/
  )
  expect(resolve(detail.properties!.user).properties).not.toHaveProperty('loginDiagnostics')
}
