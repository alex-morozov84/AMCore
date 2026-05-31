/**
 * Minimal ambient typing for the ESM-only `file-type` package.
 *
 * The API compiles with `moduleResolution: 'node'`, under which file-type's
 * `exports`-mapped types don't resolve. We only use `fileTypeFromBuffer`, so
 * declare that surface here. The real module is loaded at runtime via dynamic
 * import (Node 22 supports require-of-ESM for the compiled CommonJS form).
 */
declare module 'file-type' {
  export function fileTypeFromBuffer(
    buffer: Uint8Array
  ): Promise<{ ext: string; mime: string } | undefined>
}
