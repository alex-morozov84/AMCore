import {
  exampleInstructions,
  prepareExample,
  template,
  writeExample,
} from './product-admin-example-context.mjs'

const context = await prepareExample('roles')
const mount = context.mounts.roles
await writeExample(context, {
  'apps/web/src/_pages/custom-roles/ui/custom-roles.tsx': await template(
    'organization-roles-headless-client.tsx.fixture'
  ),
  'apps/web/src/_pages/custom-roles/index.ts': "export { CustomRoles } from './ui/custom-roles'\n",
  [mount.path]: mount.content
    .replace('@/_pages/organization-roles', '@/_pages/custom-roles')
    .replaceAll('OrganizationRolesClient', 'CustomRoles'),
  'apps/web/e2e/real-stack/organization-roles-headless.spec.ts': await template(
    'organization-roles-headless.spec.ts.fixture'
  ),
})
exampleInstructions(context, 'roles')
