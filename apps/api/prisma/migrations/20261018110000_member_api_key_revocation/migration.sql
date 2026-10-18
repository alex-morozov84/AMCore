ALTER TABLE core.api_keys DROP CONSTRAINT api_keys_revocation_state_check;
ALTER TABLE core.api_keys ADD CONSTRAINT api_keys_revocation_state_check CHECK (
  ("revokedAt" IS NULL AND "keyHash" IS NOT NULL AND salt IS NOT NULL
    AND "revokedByUserId" IS NULL AND "revocationReason" IS NULL)
  OR
  ("revokedAt" IS NOT NULL AND "keyHash" IS NULL AND salt IS NULL
    AND "revokedByUserId" IS NOT NULL AND "revocationReason" IS NOT NULL
    AND "revocationReason" IN ('owner_revoked', 'platform_revoked', 'organization_admin_revoked', 'membership_removed'))
);
CREATE INDEX "api_keys_organizationId_userId_revokedAt_id_idx"
  ON core.api_keys ("organizationId", "userId", "revokedAt", id);
