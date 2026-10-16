-- Store the avatar object key instead of a URL. No data migration: an existing URL cannot be
-- turned into a key reliably, and the avatar is re-uploaded or re-hosted on the next sign-in.
ALTER TABLE "core"."users" DROP COLUMN "avatarUrl",
ADD COLUMN "avatarKey" TEXT;
