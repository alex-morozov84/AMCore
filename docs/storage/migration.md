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

Published avatar keys are versioned and immutable, so a copy never goes stale.

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
5. **Switch the configuration at once.** Set the new `STORAGE_*` values on the API and the worker and
   restart both. Public addresses change to the new host immediately. Private files keep working,
   because their access is generated at read time.
6. **Verify.** Run `storage:check` again. Open an avatar in a private browser window.
7. **Keep the old buckets for a while.** Delete them after you are sure nothing reads them.

Objects written between the copy and the switch exist only in the old bucket. Either stop writes for
the moment of the switch, or run the copy a second time just after it.

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
