import { isIP } from 'node:net'

import { compose, inspect } from './docker.mjs'
import { dataAdmission } from './ownership.mjs'

export const fixtureVisitor = '203.0.113.75'

/** Choose an unused address only inside the already-created, owned default network. */
export async function clientIpPeer(m) {
  if (m.fixtureProfile !== 'client-ip') return
  if (m.topology !== 'path') throw new Error('Client-IP fixture requires the HTTP path stand')
  const network = await inspect(m, 'network', m.model.networks.default.name)
  if (network.Labels?.['org.amcore.stand'] !== m.uuid) throw new Error('Foreign relay network')
  const subnet = network.IPAM.Config.find((item) => isIP(item.Subnet.split('/')[0]) === 4)?.Subnet
  if (!subnet || Number(subnet.split('/')[1]) > 24) throw new Error('Unsupported fixture subnet')
  const address = subnet.split('.').slice(0, 3).join('.') + '.10'
  if (
    Object.values(network.Containers ?? {}).some(
      (item) =>
        item.IPv4Address.split('/')[0] === address &&
        !(m.clientIpPeer === address && item.Name === `${m.project}-web-1`)
    )
  )
    throw new Error('Fixture peer address occupied')
  m.clientIpPeer = address
}

async function redis(m, args) {
  await dataAdmission(m)
  return (
    await compose(m, ['exec', '-T', 'redis', 'redis-cli', '--raw', ...args], { capture: true })
  ).trim()
}

/** Browser sees only a normal error; command writes are confined to this admitted stand. */
export async function clientIpPreview(page, m, account, labels) {
  const key = `rate:login_ip:${fixtureVisitor}`
  const seed = JSON.stringify({ value: 99, expires: Date.now() + 240000 })
  await redis(m, ['SET', key, seed, 'PX', '240000'])
  try {
    await page.goto(`${m.localePrefix}/login`)
    await page.getByLabel(labels.product.email, { exact: true }).fill(account.email)
    await page.getByLabel(labels.product.password, { exact: true }).fill('Wrong-fixture-password1!')
    await page.getByRole('button', { name: labels.product.submit, exact: true }).click()
    await page.locator('[data-slot="alert"]').waitFor()
    const state = JSON.parse(await redis(m, ['GET', key]))
    if (state.value !== 100) throw new Error('Visitor failure not counted on browser path')
    await page.getByLabel(labels.product.password, { exact: true }).fill(account.password)
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: labels.product.submit, exact: true }).click()
    if ((await pending).status() !== 429)
      throw new Error('Correct password bypassed aggregate limit')
    console.log(
      'Client-IP browser: overwritten edge claim, wrong-password100 and correct-password429 proved'
    )
  } finally {
    // Remove only this profile's explicitly seeded aggregate and own failure state.
    await redis(m, [
      'DEL',
      key,
      `rate:login_user_ip:${account.email.toLowerCase()}:${fixtureVisitor}`,
      `rate:login_blocked:${account.email.toLowerCase()}:${fixtureVisitor}`,
    ])
  }
}
