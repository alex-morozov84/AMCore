// CSS-side half of the token-only styling contract.
//
// ESLint guards TSX: class strings, arbitrary colour values, and the DOM `style`
// prop. It is the wrong tool for CSS, so CSS Modules are guarded here instead.
//
// Two file classes with opposite jobs, which is why the policy is scoped rather
// than global:
//
//   `app/globals.css`   — where the tokens are *defined*. Raw colour is correct
//                         here; only base CSS validity is checked.
//   `**/*.module.css`   — where components consume tokens. Raw colour is a way
//                         around the theme, so it is rejected.
//
// CSS Modules are a supported styling surface, not an escape hatch: reach for
// them when Tailwind gets noisy, but colour still comes from `var(--token)`.

// Tailwind 4 is CSS-first, so its directives appear as unknown at-rules.
//
// Listing them is the weaker half of this config and it is a deliberate choice.
// The alternative is a shared config that teaches Stylelint Tailwind's grammar
// and validates these rules rather than skipping them — but the maintained
// option has ~8k weekly downloads against Stylelint's 10M, which is too thin a
// dependency for a starter invariant. `tailwind-csstree` (~790k weekly) is the
// better-supported foundation if this becomes worth doing properly.
const TAILWIND_AT_RULES = [
  'theme',
  'custom-variant',
  'apply',
  'utility',
  'variant',
  'source',
  'plugin',
  'reference',
  'config',
];

// Raw colour functions. `var(` is absent on purpose — a variable is a token
// reference. The `(^|[\s,(])` prefix is load-bearing: without it the bare word
// `oklch` inside `color-mix(in oklch, var(--a), var(--b))` matches and a legal
// composition of two tokens gets rejected.
//
// `color` is in the list and `color-mix` is not, which is not a contradiction:
// the pattern requires the name to be followed immediately by `(`, and
// `color-mix(` has a hyphen there. So `color(display-p3 …)` is rejected on its
// own and when nested inside a `color-mix()`, while mixing two tokens stays
// legal. This was missed on the first pass by excluding `color` outright to
// avoid a collision that does not happen.
const RAW_COLOUR_FUNCTION = '/(^|[\\s,(])(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\\(/';

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Tailwind's own form is `@import 'tailwindcss'`; the `url()` notation the
    // standard config prefers is not what Tailwind accepts.
    'import-notation': null,
    'at-rule-no-unknown': [true, { ignoreAtRules: TAILWIND_AT_RULES }],
  },
  overrides: [
    {
      files: ['**/*.module.css'],
      rules: {
        // CSS Modules are read as `styles.chartGrid`; kebab-case would force
        // `styles['chart-grid']` at every call site. The naming rule is
        // re-pointed rather than switched off.
        'selector-class-pattern': [
          '^[a-z][a-zA-Z0-9]*$',
          { message: 'CSS Module class selectors are camelCase (styles.chartGrid)' },
        ],

        // Colour must come from a token. These three between them cover every
        // spelling, including colours hidden inside shorthands — `border: 1px
        // solid red` is caught by `color-named`, and `box-shadow: 0 1px 2px
        // rgb(…)` by the disallowed-list, neither of which a
        // property-keyed rule can see.
        'color-no-hex': true,
        'color-named': 'never',
        'declaration-property-value-disallowed-list': {
          '/.+/': [RAW_COLOUR_FUNCTION],
        },
      },
    },
  ],
};
