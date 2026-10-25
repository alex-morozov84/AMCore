# Load testing

This guide repeats the reference measurement in [Capacity](capacity.md) on a host you
control, with the same traffic mix, steps and result rules. Use it when a trigger in
[Capacity → When to measure again](capacity.md#when-to-measure-again) applies, or before
you rely on the published numbers for another host class.

> **Never run this on a production deployment.** While the test entry exists, the holder
> of the test client certificate can choose any visitor address in `198.18.0.0/15`, so the
> per-address rate limits do not protect that path; the fixtures also add accounts. Use a
> disposable host, database and certificate. The scripts refuse an ordinary deployment
> (project name, database not new), but cannot recognise production in every case: never
> rename or adapt one to pass them.

## What you need

- **Host:** a disposable Linux host with the prerequisites of the
  [single-host guide](single-host-compose.md#before-you-start). Comparable with Capacity:
  2 vCPU with a 100 % share, 2 GiB RAM, not preemptible, swap off while measuring.
- **Generator:** a second Linux VM in the same private network with Docker, `curl`,
  `openssl`, `tmux`, access to Docker Hub, SSH key access to the host and an AMCore checkout
  of the same commit. 2 vCPU is enough.
- **Time:** NTP on both VMs.
- **Topology:** path mode with the bundled Postgres, as in the single-host guide.
  `PROJECT_CONTEXT.md` shows `admin_console_mode: path` or no Console; host mode and
  external databases are refused.
- **Firewall:** TCP 8443 on the host open to the generator only.

Host commands run in the deployment checkout (`/srv/amcore`), generator commands in the
generator's checkout. The scripts are in [`scripts/load-test/`](../../scripts/load-test/).

## 1. Create the test certificates

On the generator:

```bash
mkdir -m 700 ~/lt-work && cd ~/lt-work
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 7 \
  -subj /CN=amcore-load-test-ca -keyout ca.key -out ca.crt
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=k6 \
  -keyout client.key -out client.csr
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -days 7 -out client.crt
rm ca.key client.csr
printf 'Lt%s9' "$(openssl rand -hex 12)" > fixture-password
chmod 600 client.key fixture-password
```

Copy the CA certificate and the password to the host; the client key stays here:

```bash
sudo mkdir -p /srv/amcore-loadtest/ca /srv/amcore-loadtest/secrets                # host
sudo chown -R "$USER": /srv/amcore-loadtest && chmod -R 700 /srv/amcore-loadtest   # host
scp ~/lt-work/ca.crt <user>@<host>:/srv/amcore-loadtest/ca/                      # generator
scp ~/lt-work/fixture-password <user>@<host>:/srv/amcore-loadtest/secrets/       # generator
```

## 2. Prepare the host

Follow single-host steps 1–4. On a disposable host you may delete the database CA key.
Before step 5, set these keys in `.env` (this `COMPOSE_FILE` replaces the one of step 1):

```bash
LOAD_TEST_RUN_ID=lt20261025a        # 4–32 lowercase letters or digits, new per campaign
COMPOSE_PROJECT_NAME=amcore-loadtest-lt20261025a
COMPOSE_FILE=docker-compose.yml:docker/compose/supervise.yml:docker/compose/postgres-tls.yml:docker/compose/web.yml:docker/compose/bff-relay.yml:docker/compose/load-test.yml
LOAD_TEST_GENERATOR_IP=<generator IPv4 as the host sees it, usually its private address>
LOAD_TEST_CLIENT_CA_DIR=/srv/amcore-loadtest/ca
LOAD_TEST_SECRETS_DIR=/srv/amcore-loadtest/secrets
EMAIL_PROVIDER=mock
ORG_SELF_SERVICE_CREATION_ENABLED=true
```

Then:

```bash
sh scripts/load-test/fixture.sh build      # the fixture loader image
sudo swapoff -a                            # if you added swap for the build
sudo reboot                                # if you built the images on this host
sh scripts/load-test/preflight.sh plan     # changes nothing
```

Expected: `preflight plan: ok (run …, project …, route prefix '/en', generator …)`. Note
the route prefix (empty without locale routing). Rebooting after a build gives every
campaign the same clean start state.

## 3. Start the project and load the fixtures

Run single-host steps 5–7. On the generator, create `load-test.env` in the checkout (or
pass `LT_ENV=<path>` to each command):

```bash
LT_WORK=$HOME/lt-work
LT_SERVER_SSH=<user>@<host>          # an ~/.ssh/config alias works too
LT_SERVER_DIR=/srv/amcore
LT_WEB_HOST=app.example.com
LT_API_HOST=api.example.com
LT_SERVER_IP=<host address the generator connects to; the names are sent there, no DNS>
LT_PREFIX=/en                        # the route prefix from preflight plan
```

Then:

```bash
sh scripts/load-test/admission.sh probe     # generator: PASS
sh scripts/load-test/preflight.sh live      # host: preflight live: ok
sh scripts/load-test/fixture.sh             # host: load-fixture: created run …
```

The fixtures are one owner (`SUPER_ADMIN`), one organization, 200 members (1–20 are
organization admins) and 1,000 audit rows. Before writing, `fixture.sh` proves that the
volume, the rendered database URLs and the running postgres, API, worker and web
containers all belong to this run's project; shell variables such as
`COMPOSE_PROJECT_NAME` are ignored with a warning. Any refusal writes nothing; the remedy
is `docker compose down -v` and single-host step 5 again. Never relabel or adopt a volume.

## 4. Admission

Every check must pass before any load:

```bash
sh scripts/load-test/admission.sh run       # generator
```

It proves on both domains that a missing or foreign client certificate is refused, that
each request needs exactly one synthetic IPv4 visitor address, that visitors have
separate rate budgets, and that `X-AMCore-Client-Ip` and `X-Real-IP` are ignored.

From a machine that is not the generator (`curl`, an AMCore checkout of the same commit),
check the normal edge through public DNS. Use a private directory with a copy of
`fixture-password` and a `load-test.env` with only `LT_WORK=<that directory>`,
`LT_WEB_HOST`, `LT_API_HOST` and `LT_PREFIX`:

```bash
LT_ENV=<path>/load-test.env sh scripts/load-test/admission.sh outside
```

It proves that forged address headers on the normal edge change no rate budget (API and
web app). Its first line only shows that 8443 is not open to that machine; the
certificate proof is `run`. Each admission command waits up to 90 s for budgets to refill.

## 5. Measure

On the generator, inside `tmux`:

```bash
sh scripts/load-test/protocol.sh prepare     # signs in the 200 members once
sh scripts/load-test/protocol.sh smoke       # optional, repeatable; never blocks the campaign
sh scripts/load-test/protocol.sh campaign    # about 45 minutes
```

`prepare` keeps live session cookies in `~/lt-work/sessions.json`. `smoke` writes to
`~/lt-work/out-smoke`; it is valid only if every action answered as expected. The
campaign writes to `~/lt-work/out` and first prints the recovery commands (also in
`out/RECOVERY.txt`). A second campaign needs a new `LT_WORK` and, to be comparable, a fresh
host or project (section 7).

Protocol (do not change it between compared runs): 60 s warm-up at 5 iterations/s, then 5,
10, 20, 30 and 40 iterations/s for 120 s each, three repeats, 30 s apart, admin reads at
0.2 iterations/s. A warm-up or repeat that is not `valid` stops the ladder; a 5
iterations/s control step follows after 120 s idle. One iteration is one visitor action,
about 3 requests; per 1,200 iterations: 780 page browses, 180 public pages, 120 profile
updates (synchronous in-app notification), 60 team-page reads, 60 avatar uploads.

## 6. Read the result

`~/lt-work/out/report.md` has one row per step; `manifest.json` records commits, image
digests, sizes, swap and the protocol. The header must say that host and generator ran the
same commit and the same harness, otherwise the campaign is unusable. Whether the host and
data match Capacity is your comparison of those fields. The `out` directory holds no key,
cookie or password.

| Class                 | When                                                                                                                                                              | Use it as                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `valid`               | No stop condition, complete data                                                                                                                                  | A result                                             |
| `invalid measurement` | Missing or broken data (samples, server records of an action, k6/server disagreement beyond requests in flight and clock bound), or generator CPU idle < 10 %     | Nothing; fix the cause, new campaign on a fresh host |
| `observed overload`   | Server p95 > 1 s, > 1 % failed requests overall or of admin reads, dropped iterations, a container restart, recreation or OOM, or < 100 MiB available host memory | Achieved rate under overload, not capacity           |

- Report `valid` steps as results, also those before a later stop; there is no result for
  steps after the stop. Do not repeat campaigns until one passes.
- **Reference** compares valid ladder steps with Capacity: 5, 10 and 20 iterations/s
  (≈ 16, 31 and 61 requests/s) need p95 ≤ 32, 35 and 900 ms and ≥ 98 % of the offered rate.
  Lower latency is not a regression; a valid result outside needs an explanation.
- The report shows failed checks per action, all status codes (every `429` stays visible)
  and host available memory at the start and minimum of each step. A 2 GiB host has little
  headroom for this mix; compare these values between campaigns.
- Synthetic addresses prove that each member has its own rate budget. They say nothing
  about real networks, NAT or traffic from one address, which is limited much earlier.

## 7. Remove the test entry and clean up

On the host, also after any failure or lost generator connection:

```bash
sh scripts/load-test/recover.sh        # removes the overlay, recreates Caddy; repeatable
sh scripts/load-test/remove-check.sh   # only PASS lines, incl. ":8443 refuses connections"
```

If the generator is reachable, prove it there too, before closing 8443 in the firewall:

```bash
sh scripts/load-test/admission.sh removed    # generator: only PASS lines
```

It checks that 8443 refuses connections (curl exit 7; a TLS error means the entry still
runs), that the normal site answers, and that the normal edge ignores forged addresses.
Then close 8443 in the firewall (closing it first is safe; then rely on `remove-check.sh`).
A campaign still running fails its next step as `invalid measurement`.

Delete what belongs to this run only, from the deployment checkout, exactly as written
(`--profile` flags would replace `COMPOSE_PROFILES` and leave Postgres, Redis and Caddy):

```bash
docker compose ls                     # amcore-loadtest-<run id>
docker compose down -v
docker volume ls --filter label=com.docker.compose.project=amcore-loadtest-<run id>   # empty
sudo rm -rf /srv/amcore-loadtest && rm -rf ~/amcore-load-test
```

Also delete `~/lt-work` on the generator (keep `out` if you want it), the password copy on
the `outside` machine, and the VMs if they were created for the test. Never run
`docker system prune` on a shared host.

## Troubleshooting

| Symptom                                                               | Cause and action                                                                                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight live`: test-entry peers differ                             | The host sees another generator address (NAT, public address). Set it as `LOAD_TEST_GENERATOR_IP`, `docker compose up -d --force-recreate --no-deps caddy`, then probe and `preflight live` again. |
| `fixture.sh`: running service uses another URL than the configuration | The container was created from an older `.env`: `docker compose up -d --force-recreate <service>`.                                                                                                 |
| `fixture.sh`: not a fresh database or partial fixtures                | `docker compose down -v` in this project and repeat from single-host step 5.                                                                                                                       |
| No certificate, or Docker Hub times out, on a new host                | That public address may have poor outward connectivity. Give the host another address, update names and `.env`, then `docker compose up -d --wait`.                                                |
| `clock offset … not provably within 1 s`                              | Enable NTP on both VMs; if the offset is small but its bound is large, check the generator–host connection.                                                                                        |
| Admission: another identity gets `429`                                | The visitor address does not reach the limiter: `bff-relay.yml` must be in `COMPOSE_FILE` and `COMPOSE_WEB_IPV4` must match `web`.                                                                 |
| `invalid measurement` with `generator CPU`                            | Use a generator with twice the vCPUs and a new campaign on a fresh host.                                                                                                                           |
