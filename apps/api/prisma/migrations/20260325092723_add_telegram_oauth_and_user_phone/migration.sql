/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "core"."OAuthProvider" ADD VALUE 'TELEGRAM';

-- AlterTable
ALTER TABLE "core"."users" ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "core"."users"("phone");
