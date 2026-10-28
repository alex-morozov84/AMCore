-- CreateIndex
CREATE INDEX "mfa_flows_userId_securityVersion_state_idx" ON "core"."mfa_flows"("userId", "securityVersion", "state");

-- CreateIndex
CREATE INDEX "mfa_operations_flowId_kind_idx" ON "core"."mfa_operations"("flowId", "kind");
