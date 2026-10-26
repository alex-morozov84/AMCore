# Single-host production with Docker Compose

This guide deploys AMCore on one Linux server with the reference Compose stack:
bundled Postgres and Redis, the bundled Caddy edge with automatic HTTPS, the API,
the worker and the web app. At the end, the site answers on your domains, the
database accepts only TLS connections from application roles, and no data port is
reachable from the internet.

Use [Deployment & migrations](deployment.md) for rollback and other topologies, and
[Capacity](capacity.md) to size the host.

## Before you start

- A Linux host with Docker Engine and Docker Compose v2.20.2 or later. Your user can
  run `docker` without `sudo` (`sudo usermod -aG docker "$USER"`, then log in again). Read
  [Capacity](capacity.md) for CPU and memory: building the images needs more memory
  than running them.
- DNS `A`/`AAAA` records for two names that point at the host, for example
  `app.example.com` (web) and `api.example.com` (API).
- Inbound TCP 80 and 443 open to the internet in the provider firewall (Caddy
  obtains certificates over 80); UDP 443 too if you want HTTP/3.
- SSH limited to your own addresses in the provider firewall. Bots probe public SSH
  continuously; allow key login only.
- An email provider for production mail; see [Email](../email/README.md).
- For registry images: the publisher's source repository URL, matching source revision,
  expected web deployment version and three image digests. Use that repository and
  revision for `<org>/<repo>` and `<release-tag>` below; a revision may be a commit.
- Before account actions: approved mail budget, diagnostic authority and the
  [mail prerequisites](../email/delivery.md#verify-delivery-on-a-deployed-stack),
  including tracking, log redaction and queued-mail uncertainty and recovery.

In the commands below, `/srv/amcore` is the source checkout and `/srv/amcore-tls`
holds certificates. Replace the example domains and addresses with yours.

**How to edit `.env`:** `.env` starts as a copy of `.env.example`, which already
contains many keys. For every `KEY=value` in this guide, replace the existing line
if the key is there, otherwise add it. Keep each key once.

## 1. Get the source and select the overlays

```bash
sudo mkdir -p /srv/amcore /srv/amcore-tls
sudo chown "$USER": /srv/amcore /srv/amcore-tls
git clone https://github.com/<org>/<repo>.git /srv/amcore
cd /srv/amcore
git checkout <release-tag>
cp .env.example .env
chmod 600 .env
```

Set this key in `.env`, so every `docker compose` command uses the same files:

```bash
COMPOSE_FILE=docker-compose.yml:docker/compose/supervise.yml:docker/compose/postgres-tls.yml:docker/compose/web.yml:docker/compose/bff-relay.yml
```

| File               | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `supervise.yml`    | Restart after a crash or reboot; bounded container logs.            |
| `postgres-tls.yml` | Postgres accepts network connections only over TLS.                 |
| `web.yml`          | Caddy serves the web app as well as the API.                        |
| `bff-relay.yml`    | The API sees each visitor's address behind the web app (see below). |

Run plain `docker compose …` commands from `/srv/amcore` from now on. A command
with explicit `-f` files, as in other guides, replaces `COMPOSE_FILE` and silently
drops these overlays.

To pull images from a registry instead of building them, see
[Images from a registry](#images-from-a-registry).

## 2. Create the database certificates

Create a private certificate authority (CA) and a server certificate for the
name `postgres`, the address every container uses:

```bash
mkdir -p /srv/amcore-tls/ca-private /srv/amcore-tls/ca /srv/amcore-tls/server
chmod 700 /srv/amcore-tls/ca-private
cd /srv/amcore-tls
openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj "/CN=amcore-db-ca" \
  -keyout ca-private/ca.key -out ca/ca.crt
openssl req -newkey rsa:3072 -nodes -subj "/CN=postgres" \
  -keyout server/server.key -out ca-private/server.csr
printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\n' > ca-private/san.ext
openssl x509 -req -in ca-private/server.csr -CA ca/ca.crt -CAkey ca-private/ca.key \
  -CAserial ca-private/ca.srl -CAcreateserial -days 397 \
  -extfile ca-private/san.ext -out server/server.crt
```

Give the key to the user that runs Postgres in the image, and only to it:

```bash
PG_UID=$(docker run --rm --entrypoint id postgres:18-alpine -u postgres)
sudo chown "$PG_UID" server/server.key && sudo chmod 600 server/server.key
chmod 644 ca/ca.crt server/server.crt
cd /srv/amcore
```

The mounted directories now hold only `ca/ca.crt` and `server/server.{crt,key}`.
Verify a safe offline copy of `/srv/amcore-tls/ca-private/ca.key` before deleting
it from the host (`rm /srv/amcore-tls/ca-private/ca.key`); you bring it back only to renew the certificate (see
[Database TLS](#database-tls)). `ca.srl` and `san.ext` stay in `ca-private/`.
Set in `.env`:

```bash
POSTGRES_TLS_SERVER_DIR=/srv/amcore-tls/server
POSTGRES_TLS_CA_DIR=/srv/amcore-tls/ca
```

## 3. Complete `.env`

Set these keys. Generate each secret and each password separately, for example with
`openssl rand -base64 48 | tr -d '\n/+='` (letters and digits only, so the URLs need
no encoding). Note the two role passwords: you type them again in step 5.

```bash
COMPOSE_PROFILES=local-infra,edge
NODE_ENV=production
CADDY_DOMAIN=api.example.com
CADDY_WEB_DOMAIN=app.example.com
CADDY_EMAIL=<your-ops-email>
TRUST_PROXY=1
FRONTEND_URL=https://app.example.com
WEB_TRUSTED_ORIGINS=https://app.example.com
JWT_SECRET=<secret>
WEB_FRONTEND_CONTEXT_KEY=<secret>
COMPOSE_DATABASE_URL=postgresql://amcore_runtime:<runtime-password>@postgres:5432/amcore?sslmode=verify-full&sslrootcert=/etc/amcore/db-ca/ca.crt
MIGRATION_DATABASE_URL=postgresql://amcore_migrator:<migrator-password>@postgres:5432/amcore?sslmode=verify-full&sslrootcert=/etc/amcore/db-ca/ca.crt
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/app/uploads
STORAGE_PUBLIC_BASE_URL=https://api.example.com/api/v1/storage/public
WEB_PUBLIC_FILES_ORIGIN=https://api.example.com
COMPOSE_NETWORK_SUBNET=172.30.240.0/24
COMPOSE_WEB_IPV4=172.30.240.10
```

Also set the email keys from the [Email](../email/README.md) guide
(`EMAIL_PROVIDER`, the provider key and `EMAIL_FROM`), and decide
`ORG_SELF_SERVICE_CREATION_ENABLED` before the site takes traffic
([Initial organization](deployment.md#initial-organization-and-administrator)).
For S3 storage instead of local files, see
[Deployment & migrations](deployment.md#managed--vps-db-and-remote-redis-with-s3).

Check that the subnet is free on this host: `ip route` and
`docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'`
must show no overlapping range, including a VPN. The web address must lie inside
the subnet and must not be its first address (the gateway). Then
`docker compose config --quiet` must finish without output.

### Native migration CLI connection

The application, system seed and restore tools use PostgreSQL client parameters.
Keep their `MIGRATION_DATABASE_URL` and `COMPOSE_DATABASE_URL` above unchanged.
The migration image uses Prisma's native CLI, which needs its own strict TLS URL.
A successful CLI connection with `sslmode=verify-full&sslrootcert=...` does not
prove certificate verification: the native CLI can accept a wrong CA or hostname.

Have your secret manager create `/srv/amcore-secrets/migration-cli.override.yml`
outside the repository. Restrict its directory to mode `0700` and file to `0600`.
Replace the password placeholder with the same migrator credential used above;
the endpoint and database must also match. The file contains a secret, so do not
commit it or print the resolved configuration:

```yaml
services:
  migrate:
    environment:
      DATABASE_URL: 'postgresql://amcore_migrator:<migrator-password>@postgres:5432/amcore?sslmode=require&sslaccept=strict&sslcert=/etc/amcore/db-ca/ca.crt'
```

The existing `postgres-tls.yml` mounts `ca.crt` at this container path. This override
changes only the migrator's selected URL, keeping its Prisma configuration and
Tini entrypoint. It does not change API/worker credentials or the seed/restore URL.
Persist the complete file selection in `.env`, including this final override:

```bash
COMPOSE_FILE=docker-compose.yml:docker/compose/supervise.yml:docker/compose/postgres-tls.yml:docker/compose/web.yml:docker/compose/bff-relay.yml:/srv/amcore-secrets/migration-cli.override.yml
```

For registry images, replace only `supervise.yml` with `prod.yml`. Preserve the
private CLI override during preflight, deployment, status checks and upgrades.
When rotating the migrator credential or CA path, update both client-specific
configurations. Repeat the [exact-endpoint preflight](migrator-image.md#endpoint-preflight)
before deployment. Never disable certificate verification to make it pass.

## 4. Build the images

On a host with less than about 6 GB of RAM, add swap and a build-only heap size
first (the reference 2 GiB host needed both; see
[Capacity → Building the images](capacity.md#building-the-images)):

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

and set `BUILD_NODE_OPTIONS=--max-old-space-size=3072` in `.env`. It applies to the
build stage only and can stay. Then build one service at a time; parallel builds can
run a small host out of memory:

```bash
docker compose build api
docker compose build worker
docker compose build web
docker compose build migrate
docker compose --profile seed build system-seed
```

`worker` and `system-seed` use the same build as `api` and come from the build cache in
seconds. Build every service on each upgrade too: `up` builds only images that are
missing, so it would keep running an old `worker` image. The web build takes the
longest (about 18 minutes on the reference host).

## 5. Start infrastructure and create the roles

```bash
docker compose up -d --no-build --wait --wait-timeout 180 postgres redis
sed -n '1,/^-- Step 2:/p' docker/postgres/setup-roles.sql \
  | docker compose exec -T postgres psql -U amcore -d amcore -v ON_ERROR_STOP=1
docker compose exec postgres psql -U amcore -d amcore
```

The `sed` line runs Step 1 of
[`docker/postgres/setup-roles.sql`](../../docker/postgres/setup-roles.sql): two
roles that cannot log in yet. The last command opens `psql` through the container's
local socket; the `amcore` administrator cannot log in over the network with
`postgres-tls.yml`. In `psql`, type each role password from step 3 twice when
`\password` asks, then allow login:

```text
\password amcore_migrator
\password amcore_runtime
ALTER ROLE amcore_migrator LOGIN;
ALTER ROLE amcore_runtime LOGIN;
\q
```

`\password` sends only a hash, never the password itself.
[Database role separation](database-role-separation.md) explains each statement.

## 6. Migrate, grant and seed

With Postgres healthy, run the [endpoint preflight](migrator-image.md#endpoint-preflight)
using this installation's complete `COMPOSE_FILE` and migration credential:

```bash
docker compose run --rm --no-deps migrate ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
```

Stop on failure. After a successful preflight:

```bash
docker compose run --rm --no-deps migrate
sed -n '/^-- Step 3:/,/^-- Optional query-statistics observer/p' docker/postgres/setup-roles.sql \
  | docker compose exec -T postgres psql -U amcore -d amcore -v ON_ERROR_STOP=1
docker compose --profile seed run --rm system-seed
```

Expected results: `migrate` ends with `All migrations have been successfully
applied.`; the grants (Step 3) print no error; the last line of `system-seed` is
`{"status":"seeded"}`. The seed runs from the API image and needs no source tools on
the host. See [Seeding](deployment.md#seeding) for refusals and repeated runs.

## 7. Start the stack

```bash
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 worker
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 api web
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 caddy
docker compose ps
```

Stop after any failure. API, worker and web must be `healthy`; Caddy, Postgres
and Redis must be running. `--no-deps` prevents another migration after step 6.
The timeout bounds health waiting, not the whole operation. Caddy has no healthcheck;
verify HTTPS in step 8. Web health proves local Next HTTP only; see
[web container readiness](deployment.md#web-container-readiness).

## 8. Verify

1. `https://app.example.com/` opens the sign-in page. Before registration or recovery,
   approve recipients and the [mail verification budget](../email/delivery.md#verify-delivery-on-a-deployed-stack).
   `curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/api/v1/health/ready`
   prints `200`.
2. On the host, `sudo ss -tlnp` shows ports 5432, 6379, 5002 and 3000 only on
   `127.0.0.1`; only Caddy listens publicly, on 80 and 443.
3. From another machine, the four ports do not answer. For example,
   `printf 'PING\r\n' | nc -w 5 <server-ip> 6379` prints nothing. A VPN on that machine
   can make `nc -z` report every port as open; test the answer, not the connection.
4. Plaintext database access is refused:
   `docker compose exec postgres psql "host=postgres user=amcore_runtime dbname=amcore sslmode=disable"`
   ends with `pg_hba.conf rejects connection`.

Then create the first organization: [Initial organization and administrator](deployment.md#initial-organization-and-administrator),
and choose a [backup strategy](backup-restore.md) before enabling scheduled dumps. The runtime role cannot
read Prisma's history table, so backups use the read-only `amcore_backup` role:

```bash
sed -n '/^-- Optional backup reader/,$p' docker/postgres/setup-roles.sql \
  | docker compose exec -T postgres psql -U amcore -d amcore -v ON_ERROR_STOP=1
docker compose exec postgres psql -U amcore -d amcore
```

In `psql`, type a new password twice for `\password amcore_backup`, then
`ALTER ROLE amcore_backup LOGIN;` and `\q`. Set in `.env` (same query string as the
other URLs) and add `backup` to `COMPOSE_PROFILES` (keep `local-infra,edge`):

```bash
BACKUP_DATABASE_URL=postgresql://amcore_backup:<backup-password>@postgres:5432/amcore?sslmode=verify-full&sslrootcert=/etc/amcore/db-ca/ca.crt
```

Then `docker compose up -d backup`; `docker compose logs backup` shows `completed`
after the first dump.

## Images from a registry

When CI publishes images by digest
([Production deploy profile](production-deploy-profile.md)):

1. In `COMPOSE_FILE`, replace `docker/compose/supervise.yml` with
   `docker/compose/prod.yml`, and set `COMPOSE_API_IMAGE`,
   `COMPOSE_API_MIGRATOR_IMAGE` and `COMPOSE_WEB_IMAGE` in `.env` to the
   `…@sha256:<digest>` references before any other `docker compose` command
   (`prod.yml` refuses to load without them). Log in to a private registry with
   `docker login`; every `run` and `up` then checks the registry.
2. Replace step 4 with `docker compose pull` and
   `docker compose --profile seed pull system-seed`. No swap or build options are needed.
3. Steps 2, 3 and 5–8 do not change.

## Upgrades

```bash
cd /srv/amcore
git fetch --tags && git checkout <new-release-tag>
```

Read the release notes for maintenance stops. Then build every service as in step 4
(or set the new digests and pull), and follow the order in
[Upgrades](deployment.md#upgrades-new-migrations-in-a-release) — migrate, then the
worker, then api and web — with plain `docker compose` commands instead of the `-f`
forms shown there. Run the endpoint preflight first. Stop on any error; a failed
worker readiness check must prevent the API/web step:

```bash
docker compose config --quiet
# Run the exact-endpoint migrator preflight before migration.
docker compose run --rm --no-deps migrate
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 worker
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 api web
```

Caddy can return 502 during replacement; readiness waiting does not provide
continuous service. Keep Caddy running and verify the HTTPS host after replacement.

## Visitor IP through the web BFF

Browser requests reach the API through the web app's BFF. Without
`bff-relay.yml`, the API sees every visitor as the web container, so all visitors
share one rate-limit bucket per endpoint. The overlay gives `web` the fixed address
`COMPOSE_WEB_IPV4` and makes the API trust the relayed visitor address only from that
socket address ([BFF client-IP relay](deployment.md#bff-client-ip-relay-appsweb--appsapi--a-separate-contract-from-trust_proxy)).

- The bundled Caddyfiles overwrite `X-Forwarded-For`, and strip a client's
  `X-AMCore-Client-Ip` on the way to the API. On the way to the web app, the BFF itself
  drops that header before it calls the API. Keep both if you change the edge; do not
  add `trusted_proxies` without a security review.
- Supported: one web container, IPv4.
- Dedicated handlers, server reads, logout and compensation use the same required-source
  transport as the generic proxy. Password login/step-up also select the verified
  visitor budget; audit/invite inputs remain unchanged.
- To change the subnet or address of a running deployment, plan a short downtime
  and take a backup first. Edit `.env`, check `docker compose config --quiet`, then
  run `docker compose down` followed by `docker compose up -d`. The network is
  recreated; volumes and data stay. Never use `down -v`: it deletes the database.

## Database TLS

Every client must verify the server certificate against `ca.crt` and the name
`postgres`. Application, seed and restore clients use `sslmode=verify-full` and
`sslrootcert`; the native migration CLI uses the
[private strict-TLS override](#native-migration-cli-connection). Do not weaken either
client's verification to work around an error. Only `ca.key` leaves the host after
step 2; `ca.srl` and `san.ext` stay in `ca-private/` for renewals.

Both procedures below use `docker compose run --rm migrate` as the connection test.
Keep the private native-CLI override in `COMPOSE_FILE`: it selects `require`,
`strict` and `sslcert`. Expect `No pending migrations to apply.`. Run these procedures
when no upgrade is in progress; finish a pending upgrade first.

### Renew the server certificate

Renew before the date that `openssl x509 -in /srv/amcore-tls/server/server.crt -noout
-enddate` prints (397 days after issue). The CA stays the same, so the site stays up and
the clients need no restart.

1. Bring the CA key back and check that it belongs to the current CA:

   ```bash
   cd /srv/amcore-tls
   install -m 600 <offline-copy-of-ca.key> ca-private/ca.key
   [ "$(openssl x509 -in ca/ca.crt -noout -pubkey)" = "$(openssl pkey -in ca-private/ca.key -pubout)" ] && echo CA_KEY_MATCH
   openssl x509 -in ca/ca.crt -noout -enddate
   ```

   A new server certificate must not outlive the CA. If the CA expires in less than
   397 days, replace the CA instead ([Replace the CA](#replace-the-ca)).

2. Create the new pair beside the running one and check it:

   ```bash
   openssl req -newkey rsa:3072 -nodes -subj "/CN=postgres" \
     -keyout ca-private/server.key.new -out ca-private/server.csr
   openssl x509 -req -in ca-private/server.csr -CA ca/ca.crt -CAkey ca-private/ca.key \
     -CAserial ca-private/ca.srl -days 397 -extfile ca-private/san.ext \
     -out ca-private/server.crt.new
   openssl verify -CAfile ca/ca.crt ca-private/server.crt.new
   openssl x509 -in ca-private/server.crt.new -noout -ext subjectAltName   # DNS:postgres
   [ "$(openssl x509 -in ca-private/server.crt.new -noout -pubkey)" = "$(openssl pkey -in ca-private/server.key.new -pubout)" ] && echo KEY_MATCH
   ```

3. Keep the running pair for a rollback, install the new one and reload:

   ```bash
   T=/srv/amcore-tls
   sudo cp -p $T/server/server.key $T/ca-private/old-server.key
   cp -p $T/server/server.crt $T/ca-private/old-server.crt
   PG_UID=$(docker run --rm --entrypoint id postgres:18-alpine -u postgres)
   sudo install -o "$PG_UID" -m 600 $T/ca-private/server.key.new $T/server/server.key
   sudo install -m 644 $T/ca-private/server.crt.new $T/server/server.crt
   cd /srv/amcore
   docker compose exec postgres psql -U amcore -c 'SELECT pg_reload_conf()'
   docker compose logs --since 2m postgres | grep -i ssl || echo NO_SSL_ERRORS
   ```

   The last command must print `NO_SSL_ERRORS`: an SSL line there means Postgres kept
   the old files.

4. Verify, from `/srv/amcore`:
   `openssl s_client -starttls postgres -connect 127.0.0.1:5432 </dev/null 2>/dev/null | openssl x509 -noout -enddate`
   prints the new date, and `docker compose run --rm migrate` succeeds.

5. If step 4 fails, put the old pair back and reload:

   ```bash
   T=/srv/amcore-tls
   PG_UID=$(docker run --rm --entrypoint id postgres:18-alpine -u postgres)
   sudo install -o "$PG_UID" -m 600 $T/ca-private/old-server.key $T/server/server.key
   sudo install -m 644 $T/ca-private/old-server.crt $T/server/server.crt
   cd /srv/amcore
   docker compose exec postgres psql -U amcore -c 'SELECT pg_reload_conf()'
   docker compose run --rm migrate
   ```

   `migrate` must succeed, and the `s_client` command from step 4 now prints the **old**
   date. Until this rollback, already open database connections keep working but new
   ones can fail. Keep all files in
   `ca-private/` (including `ca.key` while you investigate, then move it offline
   again); after fixing the cause, retry from step 2.

6. Only after step 4 passes with the new pair, clean up:
   `sudo rm -f /srv/amcore-tls/ca-private/{ca.key,old-server.key,old-server.crt,server.key.new,server.crt.new}`.

If Postgres refuses to start after a change, check `docker compose logs postgres`; a key
that is not `0600` and owned by the Postgres user is the usual cause.

### Replace the CA

The CA expires 825 days after step 2. Clients trust only one CA, so the server pair and
`ca.crt` change together while the clients are stopped. The site answers `502` for a
few minutes; announce a maintenance window.

1. Prepare the new files outside the mounted directories, so a mistake changes nothing
   that is running:

   ```bash
   mkdir -p /srv/amcore-tls/rotate && chmod 700 /srv/amcore-tls/rotate
   cd /srv/amcore-tls/rotate
   openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj "/CN=amcore-db-ca" \
     -keyout ca.key -out ca.crt
   openssl req -newkey rsa:3072 -nodes -subj "/CN=postgres" -keyout server.key -out server.csr
   printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\n' > san.ext
   openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAserial ca.srl \
     -CAcreateserial -days 397 -extfile san.ext -out server.crt
   ```

2. Check them. Each command must succeed:

   ```bash
   openssl verify -CAfile ca.crt server.crt                   # server.crt: OK
   openssl x509 -in server.crt -noout -ext subjectAltName     # DNS:postgres
   [ "$(openssl x509 -in server.crt -noout -pubkey)" = "$(openssl pkey -in server.key -pubout)" ] && echo KEY_MATCH
   ```

3. Keep the running files for a rollback, stop every database client, install, reload,
   test the connection:

   ```bash
   cd /srv/amcore-tls
   sudo cp -p server/server.key rotate/old-server.key
   cp -p server/server.crt rotate/old-server.crt
   cp -p ca/ca.crt rotate/old-ca.crt
   cd /srv/amcore
   docker compose stop api worker web backup
   PG_UID=$(docker run --rm --entrypoint id postgres:18-alpine -u postgres)
   sudo install -o "$PG_UID" -m 600 /srv/amcore-tls/rotate/server.key /srv/amcore-tls/server/server.key
   sudo install -m 644 /srv/amcore-tls/rotate/server.crt /srv/amcore-tls/server/server.crt
   sudo install -m 644 /srv/amcore-tls/rotate/ca.crt /srv/amcore-tls/ca/ca.crt
   docker compose exec postgres psql -U amcore -c 'SELECT pg_reload_conf()'
   docker compose run --rm --no-deps migrate ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
   # Continue only after the preflight exits zero.
   docker compose run --rm --no-deps migrate
   ```

4. If `migrate` ends with `No pending migrations to apply.`, start the clients with
   `docker compose up -d --wait` (and `docker compose up -d backup` if you use it), then
   run the checks from [step 8](#8-verify). The replacement is complete when they pass.

5. If `migrate` fails with a certificate or TLS error, roll back to the old files, then
   check that the old setup works again:

   ```bash
   sudo install -o "$PG_UID" -m 600 /srv/amcore-tls/rotate/old-server.key /srv/amcore-tls/server/server.key
   sudo install -m 644 /srv/amcore-tls/rotate/old-server.crt /srv/amcore-tls/server/server.crt
   sudo install -m 644 /srv/amcore-tls/rotate/old-ca.crt /srv/amcore-tls/ca/ca.crt
   docker compose exec postgres psql -U amcore -c 'SELECT pg_reload_conf()'
   docker compose run --rm --no-deps migrate ./node_modules/.bin/prisma db execute --file ./migrator-check.sql
   # Continue only after the preflight exits zero.
   docker compose run --rm --no-deps migrate
   docker compose up -d --wait
   ```

   Keep `rotate/` and find the cause before the old CA expires.

6. After step 4 passes, keep what the next renewal needs, store the new key offline and
   remove the rest:

   ```bash
   cd /srv/amcore-tls
   cp rotate/ca.srl rotate/san.ext ca-private/
   ```

   Copy `rotate/ca.key` to offline storage, then `sudo rm -rf /srv/amcore-tls/rotate`.
   Destroy the old offline CA key: nothing trusts it any more.

## Restore a database dump

The restore replaces every object in the dump: rows created after the dump are lost. It
connects with `MIGRATION_DATABASE_URL` (the owner role) over TLS and reads dumps only
from the `postgres_backups` volume (`/backups` in the container).

1. List the dumps: `docker compose --profile restore run --rm restore` prints the
   available files and exits with an error, which is expected here.
2. Close the site and stop every writer, so nothing changes from here on:

   ```bash
   docker compose stop caddy api worker web backup
   ```

3. Keep the current state in the same volume, so the restore command can read it back:

   ```bash
   docker compose --profile restore run --rm --entrypoint sh restore \
     -c 'pg_dump --dbname="$DATABASE_URL" -Fc -f /backups/before-restore.dump' \
     && echo SAFETY_DUMP_OK
   ```

   Continue only if it prints `SAFETY_DUMP_OK`. The file replaces an earlier
   `before-restore.dump`.

4. Restore the chosen dump:

   ```bash
   docker compose --profile restore run --rm restore <dump-filename>
   ```

   If it exits with an error, the database can be partly restored. **Do not repeat
   step 3 now**: it would overwrite the safety dump with the partial state. Fix the
   cause and run step 4 again, or go back to the state of step 3 with
   `docker compose --profile restore run --rm restore before-restore.dump`; then
   continue with steps 5 and 7 (step 6 is not needed when you went back to the safety
   dump). If that also fails, keep the site closed and investigate; the safety dump stays
   in the volume.

   Dump names carry the time in UTC (`amcore-20261024T030000Z.dump` is 03:00 UTC).

5. Start only the API and the worker. The site stays closed; the API answers only on
   this host (`127.0.0.1:5002`):

   ```bash
   docker compose up -d --wait api worker
   ```

6. Make restored API keys safe before any traffic returns: the dump can contain keys
   that were revoked after it was taken. Replay those revocations or invalidate the
   restored keys as [API-key restore safety](api-key-lifecycle.md#restore) describes.
   This step is required for a dump of this installation too.

7. Open the site:

   ```bash
   docker compose up -d --wait
   ```

   Then verify with [step 8](#8-verify) and check the data you restored for.

A dump from this installation keeps table owners and the runtime role's privileges.
For a dump from another installation, follow [Backup & restore](backup-restore.md), and
before restore step 5 re-run the `setup-roles.sql` Step 3 command from
[setup step 6](#6-migrate-grant-and-seed); running it again is safe.

## Running the host

- Docker restarts a container whose process exits, including after a reboot. It
  does not restart a container that only reports `unhealthy`.
- Watch service health and disk latency from outside the host. A network disk can
  stall for minutes; the stack recovers by itself, but you need to know it happened.
- Cloud instances sold as preemptible or spot can be stopped by the provider at any
  time; do not use them for production.
- Back up the database and local files: [Backup & restore](backup-restore.md). To
  restore the database, see [Restore a database dump](#restore-a-database-dump).

## Troubleshooting

| Symptom                                                     | Action                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A service logs a certificate or `self-signed` error         | Check `POSTGRES_TLS_CA_DIR` holds the `ca.crt` that signed the server certificate, and the certificate date.                                                                                                                                                                                                           |
| `no pg_hba.conf entry` or `rejects connection`              | The URL uses a role other than `amcore_migrator`/`amcore_runtime`/`amcore_backup`, or `sslmode` is not set.                                                                                                                                                                                                            |
| `system-seed` prints `invalid_input`                        | `MIGRATION_DATABASE_URL` is empty or lacks `sslmode=verify-full`.                                                                                                                                                                                                                                                      |
| `up` fails with `Pool overlaps with other one on this host` | Choose another `COMPOSE_NETWORK_SUBNET` and a matching `COMPOSE_WEB_IPV4`.                                                                                                                                                                                                                                             |
| All visitors get `429` together                             | Check that the active Compose configuration includes `bff-relay.yml`; explicit `-f` files replace `COMPOSE_FILE`. Verify the exact trusted web peer and that the trusted edge overwrites the visitor header; see [Visitor IP](#visitor-ip-through-the-web-bff). Visitors sharing one public IP still share its budget. |

Password login and step-up use the same verified relay identity. Deploy this
accounting change with the [stopped-writer upgrade and rollback](deployment.md#password-limiter-upgrade-and-rollback).
The change can grant a fresh budget when the visitor key does not yet exist;
retaining old shared web-peer keys does not preserve per-visitor attribution.
