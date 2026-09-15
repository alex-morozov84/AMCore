export const FULL_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'build'],
  ['--filter', 'api', 'test'],
  ['--filter', 'web', 'test'],
]

export const CONSOLE_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'test'],
  ['--filter', 'web', 'build'],
]

// Unlike a direct workspace script, Turbo includes web's shared-package build.
export const WEB_BUILD_STEPS = [['exec', 'turbo', 'run', 'build', '--filter=web']]
