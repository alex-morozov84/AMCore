import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { AppAbility } from './ability.factory'
import { accessibleBy } from './prisma-ability'

it('published recipe is the exact compilable PostgreSQL-tested fixture', () => {
  const docs = readFileSync(resolve('../../docs/auth/rbac.md'), 'utf8')
  const marker = docs
    .split('<!-- role-authorization-recipe:start -->')[1]!
    .split('<!-- role-authorization-recipe:end -->')[0]!
  const snippet = marker.match(/```typescript\n([\s\S]*?)```/)![1]!
  expect(snippet).toBe(readFileSync(resolve('test/recipes/role-authorization.recipe.ts'), 'utf8'))
})

// TeamAccess is not a Prisma model: TypeMap must reject a query for it.
function queryTyping(ability: AppAbility): void {
  // @ts-expect-error administrative capability has no generated model query
  accessibleBy(ability).ofType('TeamAccess')
}
void queryTyping
