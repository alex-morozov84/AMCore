import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { requireApi, emit } from './context.mjs'
import { certificates } from './certificates.mjs'
import { connect } from './connection.mjs'
import { admitImage, internalNetwork, label } from '../migrator-lifecycle/docker.mjs'
const { PostgreSqlContainer } = requireApi('@testcontainers/postgresql')
const { Client } = requireApi('pg')
export async function fixture(f, image) {
  f.artifact = await admitImage(f, image)
  f.ssl = await certificates(f.directory)
  process.env.DOCKER_HOST = f.endpoint
  delete process.env.DOCKER_CONTEXT
  await internalNetwork(f)
  f.database = await new PostgreSqlContainer('postgres:18-alpine')
    .withName(f.containers[0])
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword(randomBytes(24).toString('hex'))
    .withLabels({ [label]: f.run })
    .withAutoRemove(false)
    .withSSL(`${f.ssl}/server.crt`, `${f.ssl}/server.key`, `${f.ssl}/ca.crt`)
    .withStartupTimeout(60000)
    .start()
  await f.docker(['network', 'connect', '--alias', 'migration-db', f.network, f.database.getId()])
  f.ca = await readFile(`${f.ssl}/ca.crt`, 'utf8')
  f.roles = {
    amcore_migrator: randomBytes(24).toString('hex'),
    amcore_runtime: randomBytes(24).toString('hex'),
  }
  f.observer = await connect(f, 'postgres')
  f.Client = Client
  const [metadata] = JSON.parse(await f.docker(['container', 'inspect', f.containers[0]]))
  emit(f, 'fixture', {
    architecture: f.artifact.Architecture,
    migrator: image,
    postgresImage: metadata.Image,
    networkInternal: true,
  })
}
