import { GUARDRAIL_BOUNDARY_TAG_PREFIX, GUARDRAIL_INPUT_CATEGORY } from './guardrail.constants'
import type { GuardInputCategory, GuardResult } from './guardrail.types'
import { CategoryTally } from './guardrail-result'

/**
 * Deterministic, low-false-positive **input guard** (Track C — ADR-054 / ADR-055, Arc D). Pure and
 * unwired here; the executor consumes it in Arc D.4. It is a *secondary* control — the structural
 * trust boundary is the real defense, so this guard is deliberately conservative:
 *
 * - it `block`s **only** an attack on AMCore's own trust-boundary envelope/markers
 *   (`ENVELOPE_MARKER_ABUSE`) — the one class that is unambiguous and near-zero false positive;
 * - generic jailbreak / direct-override / role-reset / system-prompt-probe / obfuscation phrasing
 *   only `flag`s (advisory — the run proceeds), so a legitimate prompt that merely *discusses* or
 *   quotes an injection technique is never hard-blocked (the over-defense failure mode).
 *
 * The result is content-free: bounded category codes + counts, never a snippet or the input text.
 */

/** Literal AMCore marker tokens; their presence in *input* is an attempt to forge our envelope. */
const ENVELOPE_MARKER_TOKENS = [GUARDRAIL_BOUNDARY_TAG_PREFIX, '<amcore:', '</amcore:']

/** High-signal advisory (flag-only) patterns. Imperative attack phrasings, not topic mentions. */
const FLAG_PATTERNS: { category: GuardInputCategory; pattern: RegExp }[] = [
  {
    category: GUARDRAIL_INPUT_CATEGORY.INSTRUCTION_OVERRIDE,
    pattern:
      /\b(ignore|disregard|forget|override)\b[^.?!\n]{0,40}\b(previous|above|prior|earlier|all|the|these|your)\b[^.?!\n]{0,24}\b(instructions?|rules?|prompts?|messages?|guidelines?|context)\b/i,
  },
  {
    category: GUARDRAIL_INPUT_CATEGORY.ROLE_OVERRIDE,
    pattern:
      /\byou are (now )?(a |an )?(dan\b|unrestricted\b|jailbroken\b|no longer bound\b|in developer mode\b)/i,
  },
  {
    category: GUARDRAIL_INPUT_CATEGORY.ROLE_OVERRIDE,
    pattern: /\b(dan mode|developer mode|do anything now|stay in character as)\b/i,
  },
  {
    category: GUARDRAIL_INPUT_CATEGORY.SYSTEM_PROMPT_PROBE,
    pattern:
      /\b(reveal|show|print|repeat|reproduce|output|display|leak)\b[^.?!\n]{0,30}\b(system prompt|system message|system instructions?|initial (prompt|instructions?))\b/i,
  },
]

/** Obfuscation markers (flag-only): explicit encoding keywords or a long base64-ish run. */
const OBFUSCATION_PATTERNS = [
  /\b(base64|rot13|hex[- ]?encoded|url[- ]?encoded|decode (the|this) following)\b/i,
  /[A-Za-z0-9+/]{40,}={0,2}/,
]

/** Scan untrusted user text and return a content-free verdict (Arc D input guard). */
export function scanInput(text: string): GuardResult {
  const tally = new CategoryTally()
  const lower = text.toLowerCase()

  // Block tier: any attempt to forge/reference AMCore's own boundary markers.
  for (const token of ENVELOPE_MARKER_TOKENS) {
    if (lower.includes(token)) tally.add(GUARDRAIL_INPUT_CATEGORY.ENVELOPE_MARKER_ABUSE)
  }

  // Flag tier: high-signal advisory phrasings.
  for (const { category, pattern } of FLAG_PATTERNS) {
    if (pattern.test(text)) tally.add(category)
  }
  if (OBFUSCATION_PATTERNS.some((pattern) => pattern.test(text))) {
    tally.add(GUARDRAIL_INPUT_CATEGORY.OBFUSCATION)
  }

  const verdict = tally.has(GUARDRAIL_INPUT_CATEGORY.ENVELOPE_MARKER_ABUSE)
    ? 'block'
    : tally.size > 0
      ? 'flag'
      : 'allow'
  return tally.toResult(verdict)
}
