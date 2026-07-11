-- CreateIndex
CREATE INDEX "ai_approvals_state_expiresAt_idx" ON "ai"."ai_approvals"("state", "expiresAt");
