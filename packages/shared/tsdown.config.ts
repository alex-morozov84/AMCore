import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  hooks: {
    // Process only this build's emitted files: scanning the shared directory
    // can overwrite the other format's freshly rebuilt declaration in watch mode.
    'build:done': ({ chunks }) => {
      for (const chunk of chunks) {
        if (!/\.d\.(?:ts|cts)$/.test(chunk.fileName)) continue
        const path = join(chunk.outDir, chunk.fileName)
        const code = readFileSync(path, 'utf8')
        // Rolldown retains map URLs after the DTS plugin discards map assets.
        const cleaned = code.replace(/\n\/\/# sourceMappingURL=.*(?:\n)?$/, '\n')
        if (cleaned !== code) writeFileSync(path, cleaned)
      }
    },
  },
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ['zod'], dts: { neverBundle: ['zod'] } },
  // Packed declarations have no source tree; retain the baseline without DTS maps.
  dts: { generator: 'tsc', resolver: 'oxc', sourcemap: false },
})
