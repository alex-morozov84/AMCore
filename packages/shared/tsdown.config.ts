import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'node',
  outDir: 'dist',
  // One output file per source module, so bundlers (with `sideEffects: false` in
  // package.json) drop the schemas a route never imports instead of keeping the
  // whole package in every client bundle.
  unbundle: true,
  outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ['zod'], dts: { neverBundle: ['zod'] } },
  // Packed declarations have no source tree; retain the baseline without DTS maps.
  dts: { generator: 'tsc', resolver: 'oxc', sourcemap: false },
})
