import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'node',
  outDir: 'dist',
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  hooks: {
    // Rolldown retains map URLs after the DTS plugin discards map assets.
    'build:done': ({ options }) => {
      for (const name of readdirSync(options.outDir).filter((file) =>
        /\.d\.(?:ts|cts)$/.test(file)
      )) {
        const path = join(options.outDir, name)
        const code = readFileSync(path, 'utf8')
        writeFileSync(path, code.replace(/\n\/\/# sourceMappingURL=.*(?:\n)?$/, '\n'))
      }
    },
  },
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ['zod'], dts: { neverBundle: ['zod'] } },
  // Packed declarations have no source tree; retain the baseline without DTS maps.
  dts: { generator: 'tsc', resolver: 'oxc', sourcemap: false },
})
