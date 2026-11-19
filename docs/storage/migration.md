# Moving to another provider or CDN

AMCore stores **keys**, not URLs. A user's avatar is stored as `avatarKey`, and the address is built
from `STORAGE_PUBLIC_BASE_URL` on every response. That makes a move a configuration change plus a
copy of the objects. You rewrite no database rows.

```text
before:  avatarKey = public/avatars/<user>/v-1-x/avatar-256.webp
         base      = https://old.example.com
         avatarUrl = https://old.example.com/public/avatars/<user>/v-1-x/avatar-256.webp

after:   avatarKey = (unchanged)
         base      = https://new.example.com
         avatarUrl = https://new.example.com/public/avatars/<user>/v-1-x/avatar-256.webp
```

The contents of a published avatar version stay the same, but its object can be
deleted. Reconcile the object list before switching providers, including
deletions since the first copy.

## Move to a new provider

1. **Prepare the new provider.** Create the buckets, the application account and (if needed) the
   public location. Follow the [provider page](providers/README.md).
2. **Check the new setup before you move any data.** Run
   [`storage:check`](testing.md#check-a-real-provider-with-storagecheck) with the new settings. Fix
   everything until it passes. This catches publishing mistakes while nothing depends on the new
   provider yet.
3. **Copy the objects with their keys unchanged.** Use any S3 copy tool, such as `rclone`, or the
   provider's own migration service. Keep the `public/` prefix exactly as it is. Preserve the content
   type and the `Cache-Control` value of each object: the `api` mode and CDNs use them.
4. **Re-apply ACLs if you use `acl` mode.** Copying an object does not carry its ACL on every
   provider. After the copy, new uploads are public again, but old objects may need their ACL set.
   `external` mode has no per-object step.
5. **Pause writes and reconcile the copy.** Stop writers on the API and worker. Account for
   direct uploads already granted through signed URLs. Stop issuing new upload URLs.
   Wait for outstanding grants to expire or verify that the source rejects them.
   Wait for in-flight uploads to settle. Reconcile additions, overwrites and deletions
   since the first pass. Verify keys, bytes and metadata before switching.
6. **Switch all consumers while writes remain paused.** Set the new `STORAGE_*` values
   on the API and worker. Apply any web origin change described below. Restart the consumers
   and verify their actual targets.
7. **Verify access before reopening writes.** Check public delivery and private access with
   representative objects. Run the diagnostic in [Testing](testing.md) and check the results
   for the features you use. Keep the old storage available for recovery.
8. **Reopen writes after verification.** If verification fails before writes resume, keep
   writes paused and restore the previous configuration. If the new storage has accepted writes, repeat steps 5–7 in reverse. Stop writers
   and stop issuing upload URLs. Wait for in-flight uploads to finish and for outstanding
   grants to expire, or verify that the new storage rejects those grants. Reconcile changes
   back to the old storage, including deletions, and resolve conflicts. Verify access to the
   old storage and confirm every consumer targets it before reopening writes. Keep the old buckets until consumers and any
   outstanding signed URLs no longer need them.

## Move to a CDN

You only change `STORAGE_PUBLIC_BASE_URL`. The CDN must be able to read the public bucket and must map
its root to the base address. Never use the CDN as the signing endpoint. A missing path mapping is the
usual reason for a 404: compare an avatar URL with the real object address.

## Move between buckets of the same provider

It is the same procedure as a new provider, with the same endpoint and keys. Change the bucket names
and, if the public address contains the bucket, `STORAGE_PUBLIC_BASE_URL`.

## What changes in the web app

If the public address host changes, update `WEB_PUBLIC_FILES_ORIGIN` to match its origin and restart
the web app. Otherwise the browser blocks the avatars. See
[Browser security and CSP](../frontend/browser-security-and-csp.md).
