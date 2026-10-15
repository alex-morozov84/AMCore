import { randomBytes } from 'node:crypto'
import http from 'node:http'

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

import { e2eContainerLabels } from '../e2e-owned-containers'

// Test-only S3-compatible servers, never an application runtime dependency. Both are
// pinned by digest. They speak the real S3 wire protocol, so they prove request shapes,
// addressing, multipart, presigning and publication. They do NOT prove provider policy
// semantics, and neither enforces object ACLs (both accept `x-amz-acl` and ignore it).
export const SEAWEEDFS_IMAGE =
  'chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d'
// Index digest of dxflrs/garage:v2.4.1 (linux/amd64 and linux/arm64).
export const GARAGE_IMAGE =
  'dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020'

export const BACKEND_SECRET = 'test-secret-not-real'

export interface S3Backend {
  /** SDK endpoint reachable from the test process. */
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Create an empty private bucket. */
  createBucket(name: string): Promise<void>
  /** Delete every object, so one bucket can serve many independent tests. */
  emptyBucket(name: string): Promise<void>
  stop(): Promise<void>
}

export interface AnonymousResponse {
  status: number
  body: Buffer
}

/** One unauthenticated HTTP GET. `host` overrides the Host header (Garage website vhosts). */
export function anonymousGet(url: string, host?: string): Promise<AnonymousResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: host ? { host } : {},
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) })
        )
      }
    )
    request.on('timeout', () => request.destroy(new Error(`timeout: ${url}`)))
    request.on('error', reject)
    request.end()
  })
}

export interface SeaweedIdentity {
  name: string
  actions: string[]
  credentials?: { accessKey: string; secretKey: string }[]
}

/** SeaweedFS S3 with one admin identity plus any caller-defined (e.g. anonymous) identities. */
export async function startSeaweedFs(identities: SeaweedIdentity[] = []): Promise<S3Backend> {
  const config = {
    identities: [
      {
        name: 'admin',
        credentials: [{ accessKey: 'wire-admin', secretKey: BACKEND_SECRET }],
        actions: ['Admin', 'Read', 'Write', 'List'],
      },
      ...identities,
    ],
  }
  const container = await new GenericContainer(SEAWEEDFS_IMAGE)
    .withLabels(e2eContainerLabels())
    .withCommand([
      'server',
      '-s3',
      '-s3.config=/etc/s3.json',
      '-master.volumeSizeLimitMB=16',
      '-volume.max=100',
      '-ip=127.0.0.1',
      '-ip.bind=0.0.0.0',
    ])
    .withCopyContentToContainer([{ content: JSON.stringify(config), target: '/etc/s3.json' }])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp('/', 8333).forStatusCode(403))
    .withStartupTimeout(90_000)
    .start()
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(8333)}`
  const admin = adminClient({
    endpoint,
    region: 'us-east-1',
    accessKeyId: 'wire-admin',
    secretAccessKey: BACKEND_SECRET,
  })
  return {
    endpoint,
    region: 'us-east-1',
    accessKeyId: 'wire-admin',
    secretAccessKey: BACKEND_SECRET,
    createBucket: async (name) => {
      await admin.send(new CreateBucketCommand({ Bucket: name }))
    },
    emptyBucket: (name) => emptyBucketWith(admin, name),
    stop: async () => {
      admin.destroy()
      await container.stop()
    },
  }
}

const GARAGE_KEY_ID = 'GKaaaaaaaaaaaaaaaaaaaaaaaa'
// Garage needs 32-byte hex secrets. They are generated per run instead of committed:
// a literal high-entropy hex string trips the repository's secret scan.
const GARAGE_SECRET = randomBytes(32).toString('hex')
const GARAGE_WEB_ROOT = '.web.garage.localhost'
const GARAGE_CONFIG = `
metadata_dir = "/tmp/meta"
data_dir = "/tmp/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${randomBytes(32).toString('hex')}"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[s3_web]
bind_addr = "[::]:3902"
root_domain = "${GARAGE_WEB_ROOT}"
index = "index.html"
`

export interface GarageBackend extends S3Backend {
  /** Create a bucket; `website` publishes its WHOLE content on the web endpoint. */
  createBucket(name: string, options?: { website?: boolean }): Promise<void>
  /** GET an object through the website endpoint of a bucket, as an anonymous browser would. */
  webGet(bucket: string, key: string): Promise<AnonymousResponse>
  /** Public base URL (bucket root) of a website bucket; the Host header carries the bucket. */
  webBase(bucket: string): string
}

/** Garage with one single-node layout and one access key that owns every bucket it creates. */
export async function startGarage(): Promise<GarageBackend> {
  const container: StartedTestContainer = await new GenericContainer(GARAGE_IMAGE)
    .withLabels(e2eContainerLabels())
    .withCopyContentToContainer([{ content: GARAGE_CONFIG, target: '/etc/garage.toml' }])
    .withExposedPorts(3900, 3902)
    .withWaitStrategy(Wait.forHttp('/', 3900).forStatusCodeMatching((status) => status < 600))
    .withStartupTimeout(90_000)
    .start()
  const garage = async (...args: string[]): Promise<string> => {
    const result = await container.exec(['/garage', ...args])
    if (result.exitCode !== 0) {
      throw new Error(`garage ${args.join(' ')} failed (${result.exitCode}): ${result.output}`)
    }
    return result.output
  }
  const nodeId = /^([0-9a-f]{16})\s/m.exec(await garage('status'))?.[1]
  if (!nodeId) throw new Error('garage node id not found')
  await garage('layout', 'assign', '-z', 'dc1', '-c', '1G', nodeId)
  await garage('layout', 'apply', '--version', '1')
  await garage('key', 'import', '--yes', GARAGE_KEY_ID, GARAGE_SECRET, '-n', 'wire')
  const host = container.getHost()
  const endpoint = `http://${host}:${container.getMappedPort(3900)}`
  const admin = adminClient({
    endpoint,
    region: 'garage',
    accessKeyId: GARAGE_KEY_ID,
    secretAccessKey: GARAGE_SECRET,
  })
  const webPort = container.getMappedPort(3902)
  return {
    endpoint,
    region: 'garage',
    accessKeyId: GARAGE_KEY_ID,
    secretAccessKey: GARAGE_SECRET,
    createBucket: async (name, options) => {
      await garage('bucket', 'create', name)
      await garage('bucket', 'allow', '--read', '--write', '--owner', name, '--key', 'wire')
      if (options?.website) await garage('bucket', 'website', '--allow', name)
    },
    webGet: (bucket, key) =>
      anonymousGet(`http://${host}:${webPort}/${key}`, `${bucket}${GARAGE_WEB_ROOT}:${webPort}`),
    webBase: (bucket) => `http://${bucket}${GARAGE_WEB_ROOT}:${webPort}`,
    emptyBucket: (name) => emptyBucketWith(admin, name),
    stop: async () => {
      admin.destroy()
      await container.stop()
    },
  }
}

/**
 * Remove every object from a bucket. A bucket per test is not an option on SeaweedFS:
 * it allocates a volume group per bucket, so a test suite with one bucket per test
 * exhausts the volumes and PutObject answers InternalError.
 */
async function emptyBucketWith(client: S3Client, bucket: string): Promise<void> {
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
    )
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []))
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } })
      )
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}

function adminClient(
  backend: Pick<S3Backend, 'endpoint' | 'region' | 'accessKeyId' | 'secretAccessKey'>
): S3Client {
  return new S3Client({
    endpoint: backend.endpoint,
    region: backend.region,
    forcePathStyle: true,
    credentials: { accessKeyId: backend.accessKeyId, secretAccessKey: backend.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

/**
 * An anonymous reader for Garage website buckets. Their address carries the bucket in the
 * host name (`<bucket>.web.garage.localhost`), which not every resolver maps to loopback, so
 * the request goes to the mapped port on the container host with the original Host header.
 */
export function garageRead(garage: GarageBackend): (url: string) => Promise<AnonymousResponse> {
  const endpoint = new URL(garage.endpoint)
  return (url) => {
    const target = new URL(url)
    if (!target.hostname.endsWith(GARAGE_WEB_ROOT)) return anonymousGet(url)
    return anonymousGet(
      `http://${endpoint.hostname}:${target.port}${target.pathname}${target.search}`,
      target.host
    )
  }
}
