CREATE TABLE core.support_mail_attempts (
  id UUID PRIMARY KEY,
  "actorUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email_verification','password_recovery')),
  "recipientBinding" VARCHAR(64) NOT NULL,
  "policyBinding" VARCHAR(64) NOT NULL,
  "ownerNonce" UUID,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','claimed','dispatching','accepted','simulated','refused','not_started','unknown')),
  provider TEXT NOT NULL CHECK (provider IN ('resend','mock')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('deadline','render_failed','provider_failure','auth','invalid_sender','invalid_request','rate_limit','quota','superseded','admission_changed','precheck','expired','unavailable')),
  "tokenId" TEXT,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prepareExpiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "tokenIssuedAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3),
  "dispatchAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "readUntil" TIMESTAMP(3) NOT NULL,
  "purgeAfter" TIMESTAMP(3) NOT NULL,
  CONSTRAINT support_mail_claim_facts CHECK (
    ("claimedAt" IS NULL AND "tokenId" IS NULL AND "tokenIssuedAt" IS NULL AND "deadlineAt" IS NULL)
    OR ("claimedAt" IS NOT NULL AND "tokenId" IS NOT NULL AND "tokenIssuedAt" IS NOT NULL AND "deadlineAt" IS NOT NULL)
  ),
  CONSTRAINT support_mail_dispatch_facts CHECK ("dispatchAt" IS NULL OR "claimedAt" IS NOT NULL)
);
CREATE INDEX support_mail_attempts_actorUserId_targetUserId_kind_preparedAt_idx ON core.support_mail_attempts ("actorUserId", "targetUserId", kind, "preparedAt" DESC);
CREATE INDEX support_mail_attempts_purgeAfter_id_idx ON core.support_mail_attempts ("purgeAfter", id);
CREATE INDEX support_mail_attempts_actorUserId_state_prepareExpiresAt_idx ON core.support_mail_attempts ("actorUserId", state, "prepareExpiresAt");
