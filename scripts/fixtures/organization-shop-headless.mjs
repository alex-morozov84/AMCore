import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  exampleInstructions,
  memberTemplates,
  prepareExample,
  replaceOnce,
  template,
  writeExample,
} from './product-admin-example-context.mjs'

function palette(source, values) {
  let result = source
  for (const [selector, tokens] of Object.entries(values)) {
    const pattern = new RegExp(`^${selector === ':root' ? ':root' : '\\.dark'} \\{[^}]+\\}`, 'gm')
    const blocks = [...result.matchAll(pattern)]
    if (blocks.length !== 1) throw new Error('Example palette root block changed')
    let updated = blocks[0][0]
    for (const [name, value] of Object.entries(tokens)) {
      const token = new RegExp(`--${name}: [^;]+;`, 'g')
      if ([...updated.matchAll(token)].length !== 1)
        throw new Error(`Example palette token changed: ${name}`)
      updated = updated.replace(token, `--${name}: ${value};`)
    }
    result = replaceOnce(result, blocks[0][0], updated)
  }
  return result
}

const values = JSON.parse(await template('organization-shop-headless.tokens.json.fixture'))
const context = await prepareExample('shop', process.argv.slice(2), undefined, async (source) => {
  palette(await readFile(join(source.root, 'apps/web/src/app/globals.css'), 'utf8'), values)
  if (process.argv.includes('--preview')) {
    if (!source.single || source.field('admin_console') !== 'disabled')
      throw new Error('Shop preview requires an initialized single-locale/no-Console product')
    replaceOnce(
      await readFile(join(source.root, 'scripts/stand/config.mjs'), 'utf8'),
      '  const closedCreationProfiles = [\n',
      ''
    )
  }
})
const page = 'apps/web/src/_pages/shop-team'
const files = {
  ...(await memberTemplates(`${page}/ui`)),
  [`${page}/ui/shop-team.tsx`]: await template('organization-shop-headless-client.tsx.fixture'),
  [`${page}/ui/shop-team.module.css`]: await template(
    'organization-shop-headless.module.css.fixture'
  ),
  [`${page}/index.ts`]: "export { ShopTeam } from './ui/shop-team'\n",
  'apps/web/src/_app/organization-access/server/shop-team-mount.tsx': await template(
    'organization-shop-headless.server.tsx.fixture'
  ),
  [`${context.prefix}/shop-team/page.tsx`]:
    "import { ShopTeamMount } from '@/_app/organization-access/index.server'\nexport default function Page() { return <ShopTeamMount /> }\n",
  [context.entryPath]: replaceOnce(
    context.entry,
    "export { OrganizationInvitationsMount } from './ui/invitations-mount'",
    "export { ShopTeamMount } from './server/shop-team-mount'\nexport { OrganizationInvitationsMount } from './ui/invitations-mount'"
  ),
  'apps/web/src/app/globals.css': palette(
    await readFile(join(context.root, 'apps/web/src/app/globals.css'), 'utf8'),
    values
  ),
  'apps/web/e2e/real-stack/organization-shop-headless.spec.ts': await template(
    'organization-shop-headless.spec.ts.fixture'
  ),
}
if (process.argv.includes('--preview')) {
  if (context.field('admin_console') !== 'disabled' || !context.single)
    throw new Error('Shop preview requires an initialized single-locale/no-Console product')
  files['scripts/stand/organization-fixture.mjs'] = await template(
    'organization-shop-preview.mjs.fixture'
  )
  const config = await readFile(join(context.root, 'scripts/stand/config.mjs'), 'utf8')
  files['scripts/stand/config.mjs'] = replaceOnce(
    config,
    '  const closedCreationProfiles = [\n',
    "  const closedCreationProfiles = [\n    'organization',\n"
  )
}
await writeExample(context, files)
exampleInstructions(context, 'shop', '--fixture organization-shop ')
if (process.argv.includes('--preview'))
  console.log(
    'Preview: pnpm stand preview --id t063-custom-team --profile organization; then pnpm stand status --id t063-custom-team'
  )
