-- NULL retention is conservative: cleanup must keep pre-existing families
-- until a maintained issuance path records a complete retention boundary.
ALTER TABLE "core"."auth_session_families"
    ADD COLUMN "lastAccessIssuedAt" TIMESTAMP(3),
    ADD COLUMN "retainUntil" TIMESTAMP(3);

CREATE INDEX "auth_session_families_retainUntil_idx"
    ON "core"."auth_session_families"("retainUntil");

CREATE INDEX "auth_session_families_browserContextId_idx"
    ON "core"."auth_session_families"("browserContextId");

CREATE INDEX "mfa_flows_browserContextId_idx"
    ON "core"."mfa_flows"("browserContextId");
