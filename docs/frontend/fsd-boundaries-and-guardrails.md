# Frontend Boundaries & Guardrails

The rules that keep `apps/web` structured, and the checks that enforce them.
[Architecture & conventions](./architecture-and-conventions.md) explains _what_
the layers mean; this page is about what is enforced, by which tool, and what is
deliberately left to review.

Every enforcement claim here names the tool or build-time mechanism that owns
it. If a claimed guard does not fire, that is a defect — say so rather than
working around it. The [What is not enforced](#what-is-not-enforced) section is
part of the contract too.

## Where each invariant lives

Three tools, chosen by what each can actually see:

| Surface                           | Guarded by                          | Why there                                                       |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Imports between layers and slices | ESLint (`eslint-plugin-boundaries`) | It resolves the module graph                                    |
| Tailwind classes in `.ts`/`.tsx`  | ESLint (`no-restricted-syntax`)     | Class strings are string literals in code                       |
| The DOM `style` prop              | ESLint (`react/forbid-dom-props`)   | It is JSX, not CSS                                              |
| `*.module.css`                    | Stylelint                           | CSS is Stylelint's domain; ESLint would be parsing CSS by regex |

## Import rules

### Layer direction

A layer may import layers below it, never above:

```
app  →  _pages (views)  →  widgets  →  features  →  entities  →  shared
```

```ts
// features may reach entities and shared
import { useCurrentUser } from '@/entities/user'
import { cn } from '@/shared/lib/utils'

// Inside shared: shared may not reach features — it has no business meaning
import { LoginForm } from '@/features/auth' // ✗ boundaries/dependencies
```

### Slice public API

A slice is entered at its `index.ts` and nowhere else:

```ts
import { LoginForm } from '@/features/auth/login' // ✓
import { LoginForm } from '@/features/auth/login/ui/LoginForm' // ✗
```

A slice may not reach a sibling slice in another group. A group's own barrel
(`features/auth/index.ts`) may re-export the slices inside it — that is what the
group is for:

```ts
import { LoginForm } from '@/features/auth' // ✓ group barrel

// inside features/auth/login
import { LocaleSwitcher } from '@/features/locale-switcher' // ✗ cross-slice
```

### `shared` is a collection of modules

`shared/ui` and `shared/lib` are imported per module, not through a barrel:

```ts
import { Button } from '@/shared/ui/button' // ✓
import { cn } from '@/shared/lib/utils' // ✓
```

This diverges from FSD's slice rule on purpose, and the reason is mechanical:
the shadcn CLI generates exactly this shape and has no barrel mode, so a
barrel-only rule would fight `shadcn add` on every component. `shared/api`,
`shared/store`, `shared/hooks` and `shared/pwa` keep their segment barrel — they
are hand-written and cohesive.

**There is no layer-level barrel.** `@/features`, `@/entities`, `@/shared` and
friends do not exist as import targets: a layer index pulls unrelated slices into
every consumer, and under the App Router it drags client modules into the server
graph.

## Server/client boundaries

Server Components are the default. Two separate decisions follow, and conflating
them is the usual mistake.

**Components** — add `'use client'` only at the interactive leaf: the component
that owns event handlers, effects, browser APIs, a Zustand store or a TanStack
Query hook. Everything above it stays a Server Component. A `'use client'` on a
layout makes the whole subtree ship as client JS.

**Non-component modules** — mark by capability, not by habit:

```ts
import 'client-only'

export function readStoredTheme() {
  return localStorage.getItem('theme')
}
```

Use `client-only` for modules that depend on browser-only APIs — `window`,
`document`, `localStorage`, `sessionStorage`, `navigator`, event listeners,
analytics or browser SDKs.

```ts
import 'server-only'

export function getPrivateEnv(name: string) {
  return process.env[name]
}
```

Use `server-only` for modules that depend on server-only APIs — secrets, the
filesystem, database clients, server SDK credentials, Node built-ins.

Both turn a wrong import into a **build error** instead of a runtime surprise,
which is why they are worth more than a comment.

**Do not apply either blanket-style.** A module that works in both places is
universal and should stay universal; marking it narrows where it can be used for
no benefit. `apps/web` currently has no module in either category, which is why
neither package is installed yet — add the dependency when the first module
needs it, not before.

## Styling: the palette is a source, tokens are the public API

Tailwind's default palette feeds `globals.css`, which maps it into semantic
tokens. Components consume the tokens. Three ways around that, all closed:

```tsx
<div className="bg-red-500" />           {/* ✗ default palette */}
<div className="dark:text-gray-800" />   {/* ✗ variants included */}
<div className="bg-[#8b5cf6]" />         {/* ✗ raw colour */}
<div style={{ color: 'red' }} />         {/* ✗ inline style */}

<div className="bg-card text-muted-foreground" /> {/* ✓ */}
<div className="bg-[var(--brand)]" />             {/* ✓ a variable is a token */}
<div className="w-[32px] grid-cols-[1fr_auto]" /> {/* ✓ not a colour */}
```

The palette hue names are read from the installed Tailwind rather than listed in
the config, so upgrading Tailwind extends the rule by itself.

The inline `style` prop is banned outright, not only for colours. A genuinely
dynamic value costs one `eslint-disable` with a reason, which is visible in
review — the alternative was a hand-maintained list of CSS colour properties,
which is exactly the kind of thing that rots.

## CSS Modules

CSS Modules are a **supported styling surface** for local component CSS where
Tailwind gets noisy. They are not a way around the tokens.

```css
/* Chart.module.css */
.chartGrid {
  color: var(--foreground); /* ✓ */
  border: 1px solid var(--border); /* ✓ */
  background: color-mix(in oklch, var(--card), var(--muted)); /* ✓ composing tokens */
}

.legend {
  color: #333; /* ✗ */
  background: red; /* ✗ */
  box-shadow: 0 1px 2px rgb(0 0 0); /* ✗ raw colour inside a shorthand */
}
```

Class selectors are **camelCase**, because they are read as `styles.chartGrid`.

`app/globals.css` is deliberately exempt: it is where tokens are declared, so
raw colour is correct there.

## What is not enforced

Stated so nobody assumes coverage that does not exist:

- **Over-broad `'use client'` placement.** The rule is documented and reviewed;
  there is no lint rule that proves a component is the smallest interactive
  leaf.
- **Hardcoded English copy.** The non-ASCII rule catches the mechanical half;
  English strings still need review. See [i18n](./i18n-and-errors.md) and
  [Shared UI & shadcn](./shared-ui-and-shadcn.md#hardcoded-copy-still-slips-in)
  for a real example a shadcn port produced.
- **Misused Tailwind at-rules in CSS.** Stylelint is told to accept `@theme`,
  `@apply` and friends rather than validate them; a typo like `@thme` is caught,
  a malformed `@theme` is not.
- **Transitive layer violations.** The import rules see one import at a time, not
  the graph reachable through it.

## Adding a guard

1. Write the rule, then **prove it fails by hand** — introduce the exact defect,
   watch it report, check the message names the offender.
2. Add fixtures to `src/test/eslint-guards.test.ts` or
   `src/test/stylelint-guards.test.ts`: a rejected case, an accepted case, and a
   **permissiveness case** — something adjacent that the rule must still allow.
   A rule that only proves it rejects the obvious bad case may be too broad and
   get disabled later.
3. Prove the _test_ fails: remove the rule, confirm the fixture goes red.
4. Put new `no-restricted-syntax` / `no-restricted-imports` entries in the
   **existing options object**. ESLint flat config replaces a rule's options
   rather than merging them, so a second block silently disables the first — a
   guard was lost that way once, and a test now fails the build if it recurs.

## See also

- [Architecture & conventions](./architecture-and-conventions.md) — what the
  layers mean.
- [Brand, theme & tokens](./brand-theme-and-tokens.md) — the tokens these rules
  protect.
- [i18n & errors](./i18n-and-errors.md) — the copy and error-code guards.
- [Shared UI & shadcn](./shared-ui-and-shadcn.md) — the `shared/ui` reuse
  rule the "collection of modules" section above assumes, and the safe
  procedure for touching shadcn-generated files.
