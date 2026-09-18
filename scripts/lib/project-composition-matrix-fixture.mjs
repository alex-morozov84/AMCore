import { createHash } from 'node:crypto'

import { prepareProjectInit } from './project-init-plan.mjs'

const STATE_KEYS = ['console', 'locale', 'routeProgress', 'slug', 'storybook']
const LOCALES = [undefined, 'en', 'ru']
const CONSOLES = [undefined, 'disabled', 'path', 'host']

export function allProjectStates() {
  const states = []
  for (const locale of LOCALES) {
    for (const storybook of [false, true]) {
      for (const routeProgress of [false, true]) {
        for (const console of CONSOLES) {
          if (locale || storybook || routeProgress || console) {
            states.push(
              Object.freeze({
                locale,
                storybook,
                routeProgress,
                console,
                slug: 'panel',
              })
            )
          }
        }
      }
    }
  }
  return Object.freeze(states)
}

export function flagsForState(state) {
  return {
    ...(state.locale ? { mode: 'single', locale: state.locale } : {}),
    ...(state.storybook ? { storybook: 'disabled' } : {}),
    ...(state.routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(state.console ? { 'admin-console': state.console } : {}),
  }
}

export function stateKey(state) {
  const keys = Object.keys(state).sort()
  if (JSON.stringify(keys) !== JSON.stringify(STATE_KEYS)) {
    throw new Error(`project state must contain exactly: ${STATE_KEYS.join(', ')}`)
  }
  if (!LOCALES.includes(state.locale) || !CONSOLES.includes(state.console)) {
    throw new Error('unknown project state value')
  }
  if (typeof state.storybook !== 'boolean' || typeof state.routeProgress !== 'boolean') {
    throw new Error('project state toggles must be boolean')
  }
  if (typeof state.slug !== 'string' || state.slug.length === 0) {
    throw new Error('project state slug must be a non-empty string')
  }
  if (!state.locale && !state.storybook && !state.routeProgress && !state.console) {
    throw new Error('empty project state is not supported')
  }
  return JSON.stringify(STATE_KEYS.map((key) => state[key] ?? null))
}

function immutable(value) {
  if (typeof value === 'function') {
    throw new Error('project composition projection cannot contain executable callbacks')
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const bytes =
      value instanceof ArrayBuffer
        ? Buffer.from(value)
        : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    return Object.freeze({
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  if (Array.isArray(value)) return Object.freeze(value.map(immutable))
  if (value instanceof Map) return immutable([...value.entries()])
  if (value instanceof Set) return immutable([...value.values()])
  if (!value || typeof value !== 'object') return value
  const entries = Object.entries(value).map(([key, item]) => [key, immutable(item)])
  return Object.freeze(Object.fromEntries(entries))
}

export function projectPlan(plan) {
  return immutable({
    desiredState: plan.desiredState,
    localeFacts: plan.localeFacts,
    localeSteps: plan.localeSteps,
    sharedContentFacts: plan.sharedContentFacts,
    sharedContentSteps: plan.sharedContentSteps,
    storybookFacts: plan.storybookFacts,
    steps: plan.steps,
    operations: plan.operationPlan.operationsForApply(),
    confirmMessage: plan.confirmMessage,
  })
}

export function buildProjectCompositionMatrix(root, options = {}) {
  const states = options.states ?? allProjectStates()
  const prepare = options.prepare ?? prepareProjectInit
  const keys = states.map(stateKey)
  if (new Set(keys).size !== keys.length) throw new Error('duplicate project state key')
  const rows = states.map((state, index) =>
    Object.freeze({
      key: keys[index],
      state,
      plan: projectPlan(prepare(root, flagsForState(state), state.slug)),
    })
  )
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return Object.freeze({
    buildCount: rows.length,
    rows: Object.freeze(rows),
    get(state) {
      const row = byKey.get(stateKey(state))
      if (!row) throw new Error('project state is not in the prepared matrix')
      return row
    },
  })
}
