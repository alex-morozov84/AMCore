import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import test from 'node:test'

import { parse } from 'yaml'

const config = parse(readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8'))
const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm')

test('framework and native HTTP packages enter the same first matching update group', () => {
  const packages = [
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/testing',
    '@nestjs/platform-fastify',
    '@nestjs/platform-express',
    'fastify',
    '@fastify/cookie',
  ]
  const groupFor = (name) =>
    Object.entries(npm.groups).find(([, group]) =>
      group.patterns.some((pattern) => matchesGlob(name, pattern))
    )?.[0]
  for (const name of packages) assert.equal(groupFor(name), 'fastify-stack', name)
  assert.equal(groupFor('bullmq'), 'bullmq')
  assert.equal(groupFor('@bull-board/api'), 'bull-board')
})
