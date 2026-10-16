# Wasabi

**Status: provider-documented** (Wasabi documentation read 2026-10-14). The maintainers have not run
AMCore against Wasabi. Run [`storage:check`](../testing.md#check-a-real-provider-with-storagecheck)
on your account.

## The important limit

Wasabi's documentation says that accounts created after **2023-03-13 cannot enable public access to
buckets or objects without contacting support**. If your account is newer, you cannot publish
`public/` yourself. You have two choices:

1. **Ask Wasabi support** to enable public access, then publish a separate public bucket and use the
   default `external` mode ([two-bucket layout](../public-files.md#choose-the-layout)).
2. **Use the `api` mode.** Keep every bucket private. The application reads public files with its
   own credentials and serves them at `/api/v1/storage/public`. This costs API bandwidth and you
   should put a cache in front of it. See [Public Files](../public-files.md#api).

## Settings

Wasabi uses a regional endpoint. Take the endpoint and region from the Wasabi console for your
bucket and set them in `STORAGE_ENDPOINT` and `STORAGE_REGION`.

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=<bucket>
STORAGE_REGION=<region>
STORAGE_ENDPOINT=<regional endpoint from the Wasabi console>
STORAGE_PUBLIC_DELIVERY=api
STORAGE_PUBLIC_BASE_URL=https://api.example.com/api/v1/storage/public
```

(The block shows the `api` choice. For option 1, use `external` and a public bucket.)

Wasabi recommends presigned URLs for sharing private objects, which AMCore uses for private
downloads.

## Sources

- [Wasabi: change in the ability to configure public access](https://docs.wasabi.com/docs/change-in-ability-to-configure-public-access-to-objects-and-buckets)
