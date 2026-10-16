CREATE TABLE "core"."organization_creation_results" (
    "actorId" TEXT NOT NULL,
    "operationId" UUID NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalInputHash" VARCHAR(64) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "adminRoleId" TEXT NOT NULL,
    "adminGrantId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_creation_results_pkey" PRIMARY KEY ("actorId", "operationId")
);

CREATE TABLE "core"."organization_bootstrap_results" (
    "key" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalInputHash" VARCHAR(64) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "adminRoleId" TEXT NOT NULL,
    "adminGrantId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_bootstrap_results_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "organization_bootstrap_singleton" CHECK ("key" = 'initial-organization')
);
