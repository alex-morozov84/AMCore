// Shared SWC settings for unit CJS and E2E ESM. Type checking stays in tsc.
module.exports = (useESM = false) => ({
  swcrc: false,
  jsc: {
    target: 'es2022',
    parser: { syntax: 'typescript', tsx: true, decorators: true },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: true,
      useDefineForClassFields: false,
      react: { runtime: 'automatic' },
    },
    keepClassNames: true,
  },
  module: { type: useESM ? 'es6' : 'commonjs' },
  sourceMaps: 'inline',
})
