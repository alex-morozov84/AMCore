INSERT INTO ai.ai_conversations (id, "ownerUserId", "updatedAt") VALUES ('legacy-conversation', 'legacy-owner', now());
INSERT INTO ai.ai_runs (id, "conversationId", status, "modelSnapshot", "updatedAt", "leaseToken", "leaseExpiresAt")
SELECT name, 'legacy-conversation', 'WAITING_APPROVAL', '{}', now(), 'legacy-lease', now() + interval '1 hour'
FROM unnest(ARRAY['unstarted', 'approved', 'executing', 'started-but-requested', 'read-only', 'success-unapplied', 'unknown']) AS name;
INSERT INTO ai.ai_runs (id, "conversationId", status, "modelSnapshot", "updatedAt")
VALUES ('terminal', 'legacy-conversation', 'COMPLETED', '{}', now());
INSERT INTO ai.ai_approvals (id, "runId", "conversationId", kind, state, "updatedAt", "decidedById", "decidedAt")
VALUES ('pending', 'unstarted', 'legacy-conversation', 'TOOL_INVOCATION', 'PENDING', now(), NULL, NULL),
 ('human-approved', 'approved', 'legacy-conversation', 'TOOL_INVOCATION', 'APPROVED', now(), 'legacy-owner', '2026-01-01'),
 ('human-rejected', 'terminal', 'legacy-conversation', 'TOOL_INVOCATION', 'REJECTED', now(), 'legacy-owner', '2026-01-01');
INSERT INTO ai.ai_tool_invocations (id, "runId", "toolId", status, "riskClass", "idempotency", "approvalId", "argsSnapshot", "updatedAt")
VALUES
 ('unstarted-inv', 'unstarted', 'removed_tool', 'REQUESTED', 'SENSITIVE', 'idempotent', 'pending', '{}', now()),
 ('approved-inv', 'approved', 'removed_tool', 'APPROVED', 'SENSITIVE', 'idempotent', 'human-approved', '{}', now()),
 ('executing-inv', 'executing', 'removed_tool', 'EXECUTING', 'SAFE', 'idempotent', NULL, '{}', now()),
 ('started-inv', 'started-but-requested', 'removed_tool', 'REQUESTED', 'SAFE', 'idempotent', NULL, '{}', now()),
 ('readonly-inv', 'read-only', 'removed_tool', 'EXECUTING', 'SAFE', 'read_only', NULL, '{}', now()),
 ('success-inv', 'success-unapplied', 'removed_tool', 'SUCCEEDED', 'SAFE', 'idempotent', NULL, '{}', now()),
 ('unknown-inv', 'unknown', 'removed_tool', 'OUTCOME_UNKNOWN', 'SAFE', 'idempotent', NULL, '{}', now()),
 ('terminal-inv', 'terminal', 'removed_tool', 'REJECTED', 'SENSITIVE', 'idempotent', 'human-rejected', '{}', now());
UPDATE ai.ai_tool_invocations SET "startedAt" = '2026-01-01', "executionEpoch" = 1 WHERE id IN ('started-inv', 'executing-inv', 'readonly-inv');
UPDATE ai.ai_tool_invocations SET "appliedAt" = '2026-01-01', "finishedAt" = '2026-01-01' WHERE id = 'terminal-inv';
INSERT INTO ai.ai_run_attempts (id, "runId", epoch)
SELECT 'attempt-' || id, id, 1 FROM ai.ai_runs WHERE status <> 'COMPLETED';
