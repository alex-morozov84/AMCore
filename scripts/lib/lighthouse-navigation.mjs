import { invariant } from './lighthouse-plan.mjs'

// These two internal pages are pinned Lighthouse13.6 navigation/BFCache probes.
// Neither is a measured application page, and each is admitted at most once.
export function admitNavigation(state, actual, expected) {
  if (actual === expected) {
    state.measured = (state.measured ?? 0) + 1
    state.away = false
    return 'measured'
  }
  if (actual === 'about:blank' && !state.blank && !state.measured) {
    state.blank = true
    return 'preparation-blank'
  }
  if (['chrome://terms', 'chrome://terms/'].includes(actual) && state.measured && !state.terms) {
    state.terms = true
    state.away = true
    return 'bf-cache-check'
  }
  state.invalid = true
  throw new Error('unexpected-navigation')
}
export function completeNavigation(state) {
  invariant(state.measured > 0 && !state.away && !state.invalid, 'navigation-identity-refused')
}
