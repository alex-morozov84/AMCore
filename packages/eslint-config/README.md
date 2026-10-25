# Shared lint policy

`pnpm lint` runs Oxlint 1.87.0 and ESLint 10.12.0 through `scripts/lint.mjs`.
Web also runs Stylelint. Use `pnpm lint:fix` for supported autofixes.

## Rule ownership

Oxlint runs native JavaScript, TypeScript, React, accessibility, Next and Jest rules.
ESLint retains structural syntax, import sorting, FSD boundaries, official Hooks,
TypeScript namespace checks and rules with different semantics. Each rule has one
engine owner for each path. `hybrid.js` defines exceptions to `native-rules.json`.
A native name proves availability; it does not prove complete semantic equivalence.

The JavaScript, React and accessibility JSON snapshots preserve the previously
selected recommended rules. Package updates do not silently enable new defaults.
The maintained `react/no-deprecated` guard uses public ESLint APIs. It preserves
legacy thresholds ([source license](react-policy.LICENSE)) including the baseline's named class, ES5 and computed identifier cases.
Computed string lifecycle keys retain the historical gap. It is not a complete
React semantic analyzer.

The exported `next` preset retains `eslint-plugin-react-compiler` to preserve its
existing guard, including unused `use no memo` directives. Official Hooks checks
are not a complete replacement. The active web policy already uses official Hooks.
Reconsider this legacy compiler dependency with explicit policy review.

## Paired presets

`base`, `nest` and `next` export named `policy` arrays and default residual ESLint
arrays. ESLint alone checks only residual rules. Complete consumers must run both:

1. Load the named policy from the workspace ESLint configuration.
2. Call `nativeConfig(policy, workspaceDirectory)` and write the JSON config there.
3. Run Oxlint with that config and the selected files.
4. Run ESLint with the default configuration and the same files.

The repository wrapper implements this sequence. It uses the stable public ESLint
Node API to reuse loaded plugins; Oxlint runs through its native CLI. Scoped patterns resolve relative
to the workspace config directory. Oxlint settings are global; conflicting scoped
React/accessibility/Next settings fail explicitly. React `detect` resolves the
workspace React package. Experimental JavaScript plugins are not used.

```text
policy -> native rules   -> Oxlint -> result
       -> residual rules -> ESLint -> result
web CSS -----------------> Stylelint
```

## Commands and exceptions

Run `node scripts/lint.mjs --scope api|web|shared|root|config [files...]` from any directory
using the absolute wrapper path when outside the repository. File arguments resolve
relative to the selected workspace; absolute paths also work. Options are `--fix`,
`--max-warnings=0`, `--no-warn-ignored` and `--format=json`. The JSON wrapper preserves
both engines' raw output. Oxlint custom explanations can appear in `help` rather
than `message`.

Use `oxlint-disable` with the native rule ID for native exceptions. Use
`eslint-disable` for residual exceptions. Oxlint ignores ESLint directives explicitly
and reports unused native directives. Give each exception a reason. Staged
checks run both engines after fixes and reject warnings. The wrapper fails on
engine errors or unsupported options. It does not replace typecheck.

Lint task hashes include the wrapper, fixture helper, shared policy files and the installed Tailwind theme.
A Turbo cache replay is not an executed lint check. Repeated processes are not
warm compilers. Verify cache invalidation when adding another configuration input.

Maintained CLI fixtures run in the scripts test lane. The web guard suite checks
architecture and user guidance through the paired command. Full generated
install/build/test coverage belongs to CI; successful transforms alone do not
prove installation or builds.

## Web transport guards

ESLint owns no-restricted-globals and no-restricted-properties. Web policy composes restricted imports/syntax with existing navigation and styling guards. See [scope, exact adapters and analysis limits](../../docs/frontend/api-consumption.md#server-request-boundary); use the paired wrapper for complete coverage.
