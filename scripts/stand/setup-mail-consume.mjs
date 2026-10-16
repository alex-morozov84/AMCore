import { dataAdmission, owned } from './ownership.mjs'
import { docker, inspect } from './docker.mjs'
import { cleanEnvironment, run } from './process.mjs'
import { assertOrganizationSetupFixture } from './organization-setup-fixture.mjs'

/** The active verifier authenticates the exact supervisor lease before any Docker access. */
export async function consumeSetupMail(m, to) {
  assertOrganizationSetupFixture(m)
  if (
    m.fixtureProfile !== 'organization-setup' ||
    !/^[a-z0-9._+-]{1,180}@e2e\.amcore\.test$/i.test(to)
  )
    throw new Error('Setup mail fixture unavailable')
  await dataAdmission(m)
  let collector
  for (const id of m.resources.container) {
    const container = await inspect(m, 'container', id)
    if (container.Config.Labels['com.docker.compose.service'] !== 'mail-capture') continue
    owned(m, container, 'container')
    if (
      collector ||
      container.Image !== m.images.api ||
      Object.keys(container.HostConfig.PortBindings ?? {}).length
    )
      throw new Error('Mail collector image or endpoint changed')
    collector = container.Id
  }
  if (!collector) throw new Error('Owned mail collector absent')
  const program = `let input=''; process.stdin.on('data',c=>{input+=c;if(input.length>1024)process.exit(2)});
    process.stdin.on('end',async()=>{try{const v=JSON.parse(input);const r=await fetch('http://127.0.0.1:8099/consume',{
      method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+v.key},body:JSON.stringify({to:v.to}),signal:AbortSignal.timeout(3000)});
      if(!r.ok)process.exit(3);const b=await r.text();if(Buffer.byteLength(b)>262144)process.exit(4);process.stdout.write(b);
    }catch{process.exit(5)}});`
  try {
    const result = await docker(m, ['exec', '-i', collector, 'node', '-e', program], {
      capture: true,
      input: JSON.stringify({ key: m.mailCaptureKey, to }),
    })
    if (Buffer.byteLength(result) > 262144) throw new Error('oversize')
    const value = JSON.parse(result)
    if (typeof value.html !== 'string' || typeof value.text !== 'string') throw new Error('shape')
    return value
  } catch {
    throw new Error('Setup mail unavailable; no message body retained')
  }
}

if (process.argv[1] === import.meta.filename) {
  // Never print diagnostics, nested errors or argv containing message data.
  try {
    const m = JSON.parse(
      await run(process.execPath, [`${import.meta.dirname}/active.mjs`], {
        capture: true,
        env: cleanEnvironment({
          AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
          AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
        }),
      })
    )
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (input.length > 1024) throw new Error('oversize')
    }
    const result = await consumeSetupMail(m, JSON.parse(input).to)
    process.stdout.write(JSON.stringify(result))
  } catch {
    process.stderr.write('Setup mail fixture unavailable\n')
    process.exitCode = 1
  }
}
