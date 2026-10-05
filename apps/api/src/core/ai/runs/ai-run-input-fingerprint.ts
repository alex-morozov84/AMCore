import { canonicalJsonHash } from '@/common/utils/canonical-json'

/** Version prefix of the stored run-input fingerprint; bump together with any change to the recipe below. */
const AI_RUN_FINGERPRINT_VERSION = 'v1'

/**
 * The identity of a run request for idempotent replay: `v1:` + sha256 of the canonical JSON of its
 * ordered input parts (artifact references included — their ids and order are part of the request).
 * The scope is the conversation + idempotency key. Deliberately excludes anything resolved server-side
 * (model snapshot, assistant, catalog, current artifact bindings): a normal network replay after a
 * configuration change must not conflict, and the check must not depend on catalog availability.
 */
export function aiRunInputFingerprint(inputParts: unknown): string {
  return `${AI_RUN_FINGERPRINT_VERSION}:${canonicalJsonHash(inputParts)}`
}
