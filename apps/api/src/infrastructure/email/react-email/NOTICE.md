# Vendored React Email primitives

This directory contains adapted copies of ten React Email components: Body,
Button, Container, Head, Heading, Hr, Html, Preview, Section and Text.
AMCore uses `@react-email/render` for rendering.

## Source

- Upstream repository: <https://github.com/resend/react-email>
- Tag: `react-email@6.9.0`
- Commit: `71656573fa24b09e48173ae2357bf712fcb401b6`
- Upstream path: `packages/react-email/src/components/`. The copied files
  include the ten component directories, their helpers and `element-marker.ts`.

AMCore flattens the component files and exposes them through one local barrel.
Keep this notice and its license text with distributions of the vendored code.

## License

```
Copyright 2024 Plus Five Five, Inc

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
