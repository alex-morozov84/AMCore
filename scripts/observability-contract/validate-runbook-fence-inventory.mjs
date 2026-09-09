// AMCore observability contract — catches a fenced code block that looks
// like PromQL (references an amcore_* metric or a common PromQL function)
// but isn't tagged ```promql, so it silently falls outside every other
// extraction-based guard in this suite.
import { extractAllFences } from './extract/runbook.mjs'

const LOOKS_LIKE_PROMQL =
  /amcore_[a-z_]+|(?:^|[^a-z])(?:rate|sum|histogram_quantile|increase|absent)\(/

export function findUntaggedPromqlLookingFences(fences) {
  return fences
    .filter((f) => f.tag !== 'promql' && LOOKS_LIKE_PROMQL.test(f.body))
    .map(
      (f) =>
        `${f.file}:${f.line}: fenced block looks like PromQL but is tagged "${f.tag || '(none)'}", not "promql"`
    )
}

export function runAgainstRealRepo({
  runbookPaths = [
    'docs/operations/runbooks/http.md',
    'docs/operations/runbooks/db.md',
    'docs/operations/runbooks/redis.md',
    'docs/operations/runbooks/queues.md',
    'docs/operations/runbooks/email.md',
    'docs/operations/runbooks/realtime.md',
    'docs/operations/runbooks/node-runtime.md',
    'docs/operations/runbooks/metrics-collector-health.md',
  ],
} = {}) {
  const fences = runbookPaths.flatMap((p) => extractAllFences(p))
  return findUntaggedPromqlLookingFences(fences)
}
