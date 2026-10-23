import {
  exampleInstructions,
  memberTemplates,
  prepareExample,
  template,
  writeExample,
} from './product-admin-example-context.mjs'

const context = await prepareExample('members')
const mount = context.mounts.members
const page = 'apps/web/src/_pages/custom-members'
await writeExample(context, {
  ...(await memberTemplates(`${page}/ui`)),
  [`${page}/index.ts`]: "export { CustomMembers } from './ui/custom-members'\n",
  [mount.path]: mount.content
    .replace('@/_pages/organization-members', '@/_pages/custom-members')
    .replaceAll('OrganizationMembersClient', 'CustomMembers'),
  'apps/web/e2e/real-stack/organization-members-headless.spec.ts': await template(
    'organization-members-headless.spec.ts.fixture'
  ),
})
exampleInstructions(context, 'members')
