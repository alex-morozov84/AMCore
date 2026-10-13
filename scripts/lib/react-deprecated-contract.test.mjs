import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '../..')
const plugin = pathToFileURL(path.join(ROOT, 'packages/eslint-config/react-policy.js')).href
const cases = [
  [
    'below threshold',
    { version: '16.8.0' },
    'class X extends Component {componentWillMount(){}}',
    false,
  ],
  ['threshold', { version: '17.0.0' }, 'class X extends Component {componentWillMount(){}}', true],
  [
    'PureComponent',
    { version: '19.0.0' },
    'class X extends PureComponent {componentWillMount(){}}',
    true,
  ],
  [
    'custom pragma',
    { version: '19.0.0', pragma: 'R' },
    'class X extends R.Component {componentWillMount(){}}',
    true,
  ],
  [
    'custom ES5 factory',
    { version: '19.0.0', createClass: 'make' },
    'make({componentWillMount(){}})',
    true,
  ],
  [
    'computed identifier',
    { version: '19.0.0' },
    'class X extends Component {[componentWillMount](){}}',
    true,
  ],
  [
    'computed literal baseline gap',
    { version: '19.0.0' },
    'class X extends Component {["componentWillMount"](){}}',
    false,
  ],
  [
    'unrelated class',
    { version: '19.0.0' },
    'class X extends Other {componentWillMount(){}}',
    false,
  ],
  ['unrelated object', { version: '19.0.0' }, 'const x={componentWillMount(){}}', false],
  ['require', { version: '19.0.0' }, 'const {createClass}=require("react")', true],
]

test('deprecated React policy: real ESLint10 CLI versions/settings/shapes', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'amcore-react-policy-')))
  try {
    for (const [name, settings, code, expected] of cases) {
      const config = path.join(dir, 'eslint.config.mjs')
      const file = path.join(dir, 'case.js')
      writeFileSync(
        config,
        `import {reactPolicy} from ${JSON.stringify(plugin)}; export default [{plugins:{react:reactPolicy},settings:{react:${JSON.stringify(settings)}},rules:{'react/no-deprecated':'error'}}]`
      )
      writeFileSync(file, code)
      const result = spawnSync(
        path.join(ROOT, 'node_modules/.bin/eslint'),
        ['--no-config-lookup', '--config', config, '--format=json', file],
        { cwd: dir, encoding: 'utf8' }
      )
      assert.equal(result.error, undefined)
      assert.equal(result.status, expected ? 1 : 0, `${name}: ${result.stderr} ${result.stdout}`)
      const messages = JSON.parse(result.stdout)[0].messages
      assert.ok(
        messages.every((message) => message.ruleId),
        `${name}: ignored/fatal fixture`
      )
      assert.equal(
        messages.some((message) => message.ruleId === 'react/no-deprecated'),
        expected,
        name
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
