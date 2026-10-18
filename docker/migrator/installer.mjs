import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function installerPin(manifest) {
  const match = /^pnpm@(\d+\.\d+\.\d+)\+sha512\.([a-f0-9]{128})$/.exec(manifest.packageManager)
  if (!match) throw new Error('Migrator requires an exact pnpm version and SHA512 integrity')
  return { version: match[1], hash: match[2] }
}

export function verifyArchive(bytes, hash) {
  if (createHash('sha512').update(bytes).digest('hex') !== hash)
    throw new Error('Migrator pnpm archive integrity mismatch')
}

async function install(destination) {
  if (['', '0'].includes(process.env.COREPACK_INTEGRITY_KEYS))
    throw new Error('Migrator installer requires upstream executable signature verification')
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  if (manifest.name !== '@amcore/migrator')
    throw new Error('Installer requires isolated migrator cwd')
  const { version, hash } = installerPin(manifest)
  const response = await fetch(`https://registry.npmjs.org/pnpm/-/pnpm-${version}.tgz`, {
    signal: globalThis.AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`pnpm download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  verifyArchive(bytes, hash)
  const temporary = mkdtempSync(join(tmpdir(), 'amcore-migrator-pnpm-'))
  try {
    const archive = join(temporary, 'pnpm.tgz')
    writeFileSync(archive, bytes)
    mkdirSync(destination)
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination])
    const bin = join(destination, 'bin/pnpm.mjs')
    const actual = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim()
    if (actual !== version) throw new Error(`Wrong migrator installer: ${actual}`)
    console.log(`Verified pnpm ${actual}; cwd=${process.cwd()}; manifest=${manifest.name}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await install(resolve(process.argv[2] ?? '/opt/migrator-pnpm'))
