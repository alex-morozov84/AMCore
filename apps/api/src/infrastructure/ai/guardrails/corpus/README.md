# AI guardrail injection corpus (test-only)

A small, **in-repo, license-clean** adversarial prompt-injection fixture (Track C — ADR-054 /
ADR-055, Arc D). It drives the deterministic guard unit tests and is a **regression signal, not a
proof of completeness or a security guarantee**.

- **Not vendored.** Public benchmarks (PINT, InjecGuard, NotInject, AgentDojo) informed the attack
  _categories_ only; no external dataset is copied in. Keep it authored here and small.
- **Verdict expectations** encode the Arc D stance: `block` is reserved for attacks on AMCore's own
  trust-boundary envelope/markers; generic jailbreak/override/probe phrasing only `flag`s; benign
  security-discussion prompts (even ones quoting an attack phrase) must never hard-block; non-English
  attacks are a documented best-effort gap.
- **Scope.** This seed corpus backs D.2. The full labelled gate with documented precision/recall
  floors and boundary-integrity checks lands in Arc D.5.
