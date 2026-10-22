// Every web build is followed by the route budget check, which reads that build.
export const ROUTE_BUDGET_STEP = ['check:route-budgets']

export const FULL_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'build'],
  ROUTE_BUDGET_STEP,
  ['--filter', 'api', 'test'],
  ['--filter', 'web', 'test'],
]

export const CONSOLE_VERIFY_STEPS = [
  ['typecheck'],
  ['lint'],
  ['--filter', 'web', 'test'],
  ['--filter', 'web', 'build'],
  ROUTE_BUDGET_STEP,
]

// Unlike a direct workspace script, Turbo includes web's shared-package build.
export const WEB_BUILD_STEPS = [
  ['exec', 'turbo', 'run', 'build', '--filter=@amcore/web'],
  ROUTE_BUDGET_STEP,
]
