-- Stop old invitation writers before deploying this contract upgrade.
ALTER TABLE core.org_invites
  ADD COLUMN generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "issuedAtEstimated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "intentInvalid" BOOLEAN NOT NULL DEFAULT false;
UPDATE core.org_invites SET "issuedAt" = "createdAt", "issuedAtEstimated" = true,
  "intentInvalid" = ("roleId" IS NULL);
ALTER TABLE core.org_invites ALTER COLUMN "issuedAt" SET NOT NULL,
  ALTER COLUMN "issuedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE core.org_invite_role_intents (
  id TEXT PRIMARY KEY, "inviteId" TEXT NOT NULL, ordinal INTEGER NOT NULL,
  "requestedRoleId" TEXT NOT NULL, "liveRoleId" TEXT, "roleNameAtIssue" TEXT NOT NULL,
  CONSTRAINT "org_invite_role_intents_inviteId_fkey" FOREIGN KEY ("inviteId")
    REFERENCES core.org_invites(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "org_invite_role_intents_liveRoleId_fkey" FOREIGN KEY ("liveRoleId")
    REFERENCES core.roles(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "org_invite_role_intents_inviteId_requestedRoleId_key"
  ON core.org_invite_role_intents("inviteId", "requestedRoleId");
CREATE UNIQUE INDEX "org_invite_role_intents_inviteId_ordinal_key"
  ON core.org_invite_role_intents("inviteId", ordinal);
CREATE INDEX "org_invite_role_intents_liveRoleId_idx" ON core.org_invite_role_intents("liveRoleId");
INSERT INTO core.org_invite_role_intents
  (id, "inviteId", ordinal, "requestedRoleId", "liveRoleId", "roleNameAtIssue")
SELECT 'legacy:' || i.id, i.id, 0, i."roleId", i."roleId", r.name
  FROM core.org_invites i JOIN core.roles r ON r.id = i."roleId";
ALTER TABLE core.org_invites DROP COLUMN "roleId";
DROP INDEX core."org_invites_organizationId_createdAt_idx";
CREATE INDEX "org_invites_organizationId_issuedAt_id_idx"
  ON core.org_invites("organizationId", "issuedAt" DESC, id);
CREATE TABLE core.invitation_continuations (
  id TEXT PRIMARY KEY, "credentialHash" TEXT NOT NULL, "inviteId" TEXT NOT NULL,
  generation INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitation_continuations_inviteId_fkey" FOREIGN KEY ("inviteId")
    REFERENCES core.org_invites(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "invitation_continuations_credentialHash_key" ON core.invitation_continuations("credentialHash");
CREATE INDEX "invitation_continuations_expiresAt_idx" ON core.invitation_continuations("expiresAt");
CREATE TABLE core.invitation_operations (
  id TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "organizationId" TEXT,
  scope TEXT NOT NULL, "operationId" UUID NOT NULL, kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL, intent JSONB NOT NULL, result JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitation_operations_actorId_fkey" FOREIGN KEY ("actorId")
    REFERENCES core.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invitation_operations_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES core.organizations(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "invitation_operations_actorId_scope_operationId_key"
  ON core.invitation_operations("actorId", scope, "operationId");
CREATE INDEX "invitation_operations_completedAt_idx" ON core.invitation_operations("completedAt");
CREATE TABLE core.invitation_auth_handoffs (
  "attemptId" TEXT PRIMARY KEY, "cleanupKeyHash" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  deadline TIMESTAMP(3) NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "settledAt" TIMESTAMP(3),
  CONSTRAINT "invitation_auth_handoffs_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES core.sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invitation_auth_handoffs_actorId_fkey" FOREIGN KEY ("actorId")
    REFERENCES core.users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "invitation_auth_handoffs_sessionId_key" ON core.invitation_auth_handoffs("sessionId");
CREATE INDEX "invitation_auth_handoffs_status_deadline_idx" ON core.invitation_auth_handoffs(status, deadline);
CREATE INDEX "invitation_auth_handoffs_createdAt_idx" ON core.invitation_auth_handoffs("createdAt");
