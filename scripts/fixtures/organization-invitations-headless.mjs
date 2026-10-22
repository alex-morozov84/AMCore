import {
  exampleInstructions,
  prepareExample,
  template,
  writeExample,
} from './product-admin-example-context.mjs'

const context = await prepareExample('invitations')
const mount = context.mounts.invitations
await writeExample(context, {
  'apps/web/src/_pages/custom-invitations/ui/custom-invitations.tsx': await template(
    'organization-invitations-headless-client.tsx.fixture'
  ),
  'apps/web/src/_pages/custom-invitations/index.ts':
    "export { CustomInvitations } from './ui/custom-invitations'\n",
  [mount.path]: mount.content
    .replace('@/_pages/organization-invitations', '@/_pages/custom-invitations')
    .replaceAll('OrganizationInvitationsClient', 'CustomInvitations'),
  'apps/web/e2e/real-stack/organization-invitations-headless.spec.ts': await template(
    'organization-invitations-headless.spec.ts.fixture'
  ),
})
exampleInstructions(context, 'invitations')
