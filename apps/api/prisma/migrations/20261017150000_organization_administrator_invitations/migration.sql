CREATE TABLE core.organization_administrator_invitations (
  id UUID PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  "creatorUserId" TEXT NOT NULL,
  "fingerprintVersion" INTEGER NOT NULL DEFAULT 1,
  fingerprint VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'awaiting',
  "currentInviteId" TEXT REFERENCES core.org_invites(id) ON DELETE SET NULL,
  "currentGeneration" INTEGER,
  "inviteLocale" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "attemptId" UUID,
  "attemptInviteId" TEXT,
  "attemptGeneration" INTEGER,
  "attemptAt" TIMESTAMP(3),
  "mailOutcome" TEXT,
  "mailObservedAt" TIMESTAMP(3),
  CHECK (revision > 0 AND "fingerprintVersion" = 1),
  CHECK (state IN ('awaiting','completed','cancelled')),
  CHECK ((state = 'completed') = ("completedAt" IS NOT NULL)),
  CHECK ((state = 'cancelled') = ("cancelledAt" IS NOT NULL)),
  CHECK (state = 'awaiting' OR ("currentInviteId" IS NULL AND "currentGeneration" IS NULL)),
  CHECK ("currentInviteId" IS NULL OR "currentGeneration" > 0),
  CHECK ("mailOutcome" IS NULL OR "mailOutcome" IN ('unconfirmed','provider_acknowledged','mock'))
);
CREATE UNIQUE INDEX "organization_administrator_invitations_currentInviteId_key"
  ON core.organization_administrator_invitations("currentInviteId");
CREATE INDEX "organization_administrator_invitations_organizationId_state_c_idx"
  ON core.organization_administrator_invitations("organizationId",state,"createdAt",id);
CREATE INDEX "organization_administrator_invitations_state_completedAt_can_idx"
  ON core.organization_administrator_invitations(state,"completedAt","cancelledAt");
