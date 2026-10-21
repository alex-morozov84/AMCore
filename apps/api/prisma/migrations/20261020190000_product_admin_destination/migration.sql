-- Existing links remain site-owned. New trusted browser flows pin their placement.
ALTER TABLE "core"."password_reset_tokens"
  ADD COLUMN "frontendDestination" TEXT NOT NULL DEFAULT 'site',
  ADD COLUMN "placementFingerprint" TEXT;
ALTER TABLE "core"."email_verification_tokens"
  ADD COLUMN "frontendDestination" TEXT NOT NULL DEFAULT 'site',
  ADD COLUMN "placementFingerprint" TEXT;
ALTER TABLE "core"."org_invites"
  ADD COLUMN "frontendDestination" TEXT NOT NULL DEFAULT 'site',
  ADD COLUMN "placementFingerprint" TEXT;

ALTER TABLE "core"."password_reset_tokens" ADD CONSTRAINT "password_reset_frontend_destination"
  CHECK ("frontendDestination" IN ('site', 'admin'));
ALTER TABLE "core"."email_verification_tokens" ADD CONSTRAINT "verification_frontend_destination"
  CHECK ("frontendDestination" IN ('site', 'admin'));
ALTER TABLE "core"."org_invites" ADD CONSTRAINT "org_invite_frontend_destination"
  CHECK ("frontendDestination" IN ('site', 'admin'));
