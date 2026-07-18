# Vendored email primitives — provenance and license

The `.tsx`/`.ts` files in this directory (except `index.ts` and this file) are
vendored, lightly-adapted copies of unstyled HTML-email primitives from the
[React Email](https://github.com/resend/react-email) project. AMCore uses
only these 10 basic components (`Body`, `Button`, `Container`, `Head`,
`Heading`, `Hr`, `Html`, `Preview`, `Section`, `Text`) — no `Tailwind`,
`CodeBlock`, `Markdown`, `Row`/`Column`, `Img`, or `Font` — and none of the
CLI / dev-server / editor tooling that ships alongside them in the `react-email`
package.

This is **not** a fork of React Email and does not track its releases. It is a
one-time copy of a small, stable, MIT-licensed primitive layer, kept in sync
manually only if AMCore's needs change. Rendering is still delegated to the
upstream, actively-maintained `@react-email/render` package — nothing here
reimplements rendering, only the JSX primitives.

**Why vendored instead of depending on the package:** `@react-email/components`
— and every individual `@react-email/*` component package it wraps — is
deprecated upstream. The suggested replacement, the unified `react-email`
package, ships CLI/dev-server/editor tooling (`socket.io`, `esbuild`,
`tailwindcss`, `prismjs`, `marked`, etc.) as unconditional `dependencies`.
AMCore's `apps/api` deploys via `pnpm deploy --prod`, which materializes a
flat `node_modules` for the production image rather than bundling — so those
dependencies get installed regardless of whether the app imports them,
measured at tens of megabytes added to the production image for tooling that
never runs there. AMCore's actual usage is exactly the 10 primitives listed
above, none of which need anything beyond React, so vendoring them removes
both the deprecated-dependency risk and the image-size cost.

## Source

- Upstream repository: <https://github.com/resend/react-email>
- Tag: `react-email@6.9.0`
- Commit: `71656573fa24b09e48173ae2357bf712fcb401b6`
- Upstream path: `packages/react-email/src/components/{body,button,container,head,heading,hr,html,preview,section,text}/`
  (plus their `utils/` helpers, `element-marker.ts`, and `body/margin-properties.ts`)

Adaptations from upstream: flattened out of per-component subdirectories,
dropped the trivial per-component `index.ts` barrels in favor of one barrel
here, and relative imports had their `.js` extensions stripped to match this
repository's TypeScript module-resolution convention. No behavioral changes.

## License

```
Copyright 2024 Plus Five Five, Inc

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
