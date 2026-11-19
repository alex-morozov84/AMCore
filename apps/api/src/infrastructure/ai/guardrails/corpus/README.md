# AI guardrail corpus

These locally authored, test-only fixtures exercise the input and output
guards. The unit tests check expected verdicts and content-free results. See
[injection-corpus.spec.ts](./injection-corpus.spec.ts) and
[corpus-harness.spec.ts](./corpus-harness.spec.ts).

Keep fixture text synthetic and free of credentials and user content. Use
[AI security](../../../../../../../docs/ai/security.md#guardrails) for the
current guard behavior and limitations. Passing the corpus checks provides
regression evidence for those cases.
