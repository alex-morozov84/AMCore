/** Console presentation glue is removed while account MFA and its authority remain. */
export const operationsConsoleAuthSeams = [
  ['browser-bootstrap-handler.ts', ['IMPORT', 'LOCALE', 'INPUT', 'VALIDATION', 'TYPE', 'BINDING']],
  ['mfa-pending-handler.ts', ['IMPORT', 'DESTINATION', 'RESULT']],
  ['mfa-reconcile-login.ts', ['IMPORT', 'DESTINATION', 'RESULT']],
].flatMap(([file, blocks]) =>
  blocks.map((name) => ({
    id: `console.return.${file}.${name.toLowerCase()}`,
    path: `apps/web/src/shared/api/bff/${file}`,
    kind: 'file',
    cardinality: 'one',
    seamKind: 'owned-block',
    selector: {
      start: `// AMCORE_CONSOLE_RETURN_${name}_START`,
      end: `// AMCORE_CONSOLE_RETURN_${name}_END`,
    },
    detectors: [
      `AMCORE_CONSOLE_RETURN_${name}_START`,
      ...(name === 'IMPORT' ? ['feature-import'] : []),
    ],
    ...(name === 'IMPORT'
      ? {
          removeImports: [
            `apps/web/src/shared/api/bff/${file === 'browser-bootstrap-handler.ts' ? 'console-return-claim.ts' : 'console-return-destination.ts'}`,
          ],
        }
      : {}),
    disposition: 'remove',
    operationKey: `console.return.${file}`,
  }))
)

export const operationsConsoleMfaDocSeams = [
  ['mfa-browser.md', ['PROFILE', 'RETURN']],
  ['mfa-foundation.md', ['ADAPTER', 'RECOVERY']],
].flatMap(([file, blocks]) =>
  blocks.map((name) => ({
    id: `console.docs.${file}.${name.toLowerCase()}`,
    path: `docs/auth/${file}`,
    kind: 'file',
    cardinality: 'one',
    seamKind: 'owned-block',
    selector: {
      start: `<!-- AMCORE_CONSOLE_MFA_${name}_START -->`,
      end: `<!-- AMCORE_CONSOLE_MFA_${name}_END -->`,
      consumeBlankLine: true,
    },
    detectors: [`AMCORE_CONSOLE_MFA_${name}_START`],
    disposition: 'remove',
    operationKey: `console.docs.${file}`,
  }))
)
