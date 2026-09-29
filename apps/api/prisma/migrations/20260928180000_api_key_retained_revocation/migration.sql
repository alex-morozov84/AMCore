ALTER TABLE core.api_keys
  ALTER COLUMN "keyHash" DROP NOT NULL,
  ALTER COLUMN salt DROP NOT NULL,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedByUserId" TEXT,
  ADD COLUMN "revocationReason" TEXT;

ALTER TABLE core.api_keys ADD CONSTRAINT api_keys_revocation_state_check CHECK (
  ("revokedAt" IS NULL AND "keyHash" IS NOT NULL AND salt IS NOT NULL
    AND "revokedByUserId" IS NULL AND "revocationReason" IS NULL)
  OR
  ("revokedAt" IS NOT NULL AND "keyHash" IS NULL AND salt IS NULL
    AND "revokedByUserId" IS NOT NULL AND "revocationReason" IS NOT NULL
    AND "revocationReason" IN ('owner_revoked', 'platform_revoked'))
);

CREATE INDEX "api_keys_revokedAt_idx" ON core.api_keys ("revokedAt");
CREATE INDEX "api_keys_createdAt_id_idx" ON core.api_keys ("createdAt" DESC, id DESC);
