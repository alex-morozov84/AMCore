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

**Why vendored instead of depending on the package:** see
`ai/decisions/adr-0XX-vendor-react-email-primitives.md` (private maintainer
repo) and `docs/email/README.md`.

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
