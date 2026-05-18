-- CreateIndex
CREATE INDEX "org_invites_organizationId_createdAt_idx" ON "core"."org_invites"("organizationId", "createdAt");
