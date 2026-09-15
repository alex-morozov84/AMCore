import { afterEach, describe, it } from 'node:test'
import {
  applyProject,
  createCommittedCopy,
  verifyProjectSteps,
} from './lib/init-project-test-helpers.mjs'
import {
  ADMIN_CONSOLE_ENABLED_SCENARIOS,
  ADMIN_CONSOLE_VERIFY_STEPS,
} from './lib/scaffold-scenario-recipes.mjs'
import { installDependencies } from './lib/test-fixture.mjs'

const copies = []

afterEach(() => copies.splice(0).forEach((copy) => copy.cleanup()))

describe('init-project --admin-console build outputs', () => {
  it('builds both enabled topology outputs after actual CLI application', () => {
    for (const scenario of ADMIN_CONSOLE_ENABLED_SCENARIOS) {
      const root = createCommittedCopy(copies)
      installDependencies(root)
      applyProject(
        root,
        scenario.flags.filter((flag) => flag !== '--yes')
      )
      verifyProjectSteps(root, ADMIN_CONSOLE_VERIFY_STEPS)
    }
  })
})
