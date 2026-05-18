-- CreateTable
CREATE TABLE "core"."org_invites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailCanonical" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT,
    "invitedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_invites_tokenHash_key" ON "core"."org_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "org_invites_emailCanonical_idx" ON "core"."org_invites"("emailCanonical");

-- CreateIndex
CREATE INDEX "org_invites_expiresAt_idx" ON "core"."org_invites"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "org_invites_organizationId_emailCanonical_key" ON "core"."org_invites"("organizationId", "emailCanonical") WHERE ("acceptedAt" IS NULL AND "revokedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "core"."org_invites" ADD CONSTRAINT "org_invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."org_invites" ADD CONSTRAINT "org_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "core"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."org_invites" ADD CONSTRAINT "org_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "core"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."org_invites" ADD CONSTRAINT "org_invites_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "core"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."org_invites" ADD CONSTRAINT "org_invites_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "core"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
