// The env schema is defined in domain sections under `env/schema/`. This module is
// a stable compatibility shim: `@/env` / `./env` import sites (validate, Env, …)
// keep working while the definitions live in the composed, introspectable schema.
// Explicit `/schema` subpath avoids the file-vs-directory ambiguity of `./env`.
export * from './env/schema/index'
