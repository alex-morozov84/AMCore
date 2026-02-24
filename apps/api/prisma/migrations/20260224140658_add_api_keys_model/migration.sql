-- CreateTable
CREATE TABLE "core"."api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortToken" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_shortToken_key" ON "core"."api_keys"("shortToken");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "core"."api_keys"("userId");

-- CreateIndex
CREATE INDEX "api_keys_expiresAt_idx" ON "core"."api_keys"("expiresAt");

-- AddForeignKey
ALTER TABLE "core"."api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
