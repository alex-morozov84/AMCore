# Load testing

This guide repeats the reference measurement in [Capacity](capacity.md) on a host
you control: same traffic mix, same steps, same result rules. Use it when one of the
triggers in [Capacity → When to measure again](capacity.md#when-to-measure-again)
applies, or before you rely on the published numbers for a different host class.

> **Never run this on a production deployment.** The test entry lets the holder of
> the test client certificate choose any visitor address in `198.18.0.0/15`, so the
> per-address rate limits stop protecting that path. Use a disposable host, a
> disposable database and a temporary certificate, and remove the entry afterwards.

## What you need

- **Host:** a disposable Linux host prepared with the prerequisites of the
  [single-host guide](single-host-compose.md#before-you-start) (Docker, DNS for two
  names, ports 80 and 443). For numbers comparable with Capacity: 2 vCPU with a 100 %
  guaranteed share, 2 GiB RAM, not preemptible, swap off while measuring.
- **Generator:** a second VM in the same region with Docker, `curl`, `openssl`, and an
  AMCore checkout of the same commit. It needs SSH access to the host (key login). Its
  CPU must not saturate; the report marks a step invalid when it does. 2 vCPU is enough
  for the reference steps.
- **Topology:** the product web edge in path mode, as in the single-host guide, with the
  bundled Postgres. A Console on its own host (`admin_console_mode: host` in
  `PROJECT_CONTEXT.md`) and external databases are not supported; `preflight.sh`
  refuses them. Locale routing and a disabled Console are supported.
- **Provider firewall:** TCP 8443 on the host open to the generator's address only.

The scripts are in [`scripts/load-test/`](../../scripts/load-test/). Host commands run
from the deployment checkout (`/srv/amcore` below), generator commands from the
generator's checkout.

## 1. Create the test certificates

On the generator, in a new private directory `~/lt-work` (it becomes `LT_WORK`):

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

`ca.key` is deleted at once: no further certificate can be issued. Copy `ca.crt` and
`fixture-password` to the host (for example `scp`) into two separate directories,
`/srv/amcore-loadtest/ca/` and `/srv/amcore-loadtest/secrets/`. The client key never
leaves the generator.

## 2. Plan the deployment on the host

Follow the single-host guide steps 1–4 (source, database certificates, `.env`,
images) with these changes **before step 5**, so the database volume is created for
this run only:

```bash
LOAD_TEST_RUN_ID=lt20261025a
COMPOSE_PROJECT_NAME=amcore-loadtest-lt20261025a
COMPOSE_FILE=docker-compose.yml:docker/compose/supervise.yml:docker/compose/postgres-tls.yml:docker/compose/web.yml:docker/compose/bff-relay.yml:docker/compose/load-test.yml
LOAD_TEST_GENERATOR_IP=<generator address as the host sees it>
LOAD_TEST_CLIENT_CA_DIR=/srv/amcore-loadtest/ca
LOAD_TEST_SECRETS_DIR=/srv/amcore-loadtest/secrets
EMAIL_PROVIDER=mock
ORG_SELF_SERVICE_CREATION_ENABLED=true
```

- `LOAD_TEST_RUN_ID`: 4–32 lowercase letters or digits, new for every fresh host. The
  project name must be `amcore-loadtest-<run id>`.
- `LOAD_TEST_GENERATOR_IP`: one IPv4 address, usually the generator's private address
  in the same network. Ranges and IPv6 are refused.
- Mock email: the test sends no mail.

Also build the fixture loader: `sh scripts/load-test/fixture.sh build`
(it reuses the API build stage). Then check the plan; it changes nothing:

```bash
sh scripts/load-test/preflight.sh plan
```

Expected result: `preflight plan: ok (run …, project …, route prefix '/en', generator …)`.
Note the route prefix (empty for a single-locale project). Fix every refusal before
you continue.

## 3. Start the run's project and load the fixtures

Run single-host steps 5–7 unchanged. Then, on the generator, create `load-test.env` in
the checkout root (or anywhere, with `LT_ENV=<path>` before each command):

```bash
LT_WORK=$HOME/lt-work
LT_SERVER_SSH=<user>@<host address>
LT_SERVER_DIR=/srv/amcore
LT_WEB_HOST=app.example.com
LT_API_HOST=api.example.com
LT_SERVER_IP=<host address the generator connects to>
LT_PREFIX=/en
```

and send one probe from the generator checkout, then check the live deployment and load
the fixtures on the host:

```bash
sh scripts/load-test/admission.sh probe                  # generator
sh scripts/load-test/preflight.sh live                   # host
sh scripts/load-test/fixture.sh                          # host
```

Expected results: the probe `PASS`es; `preflight live: ok`; the loader prints
`load-fixture: created run …`. The fixtures are one owner account (also
`SUPER_ADMIN`), one organization, 200 members (members 1–20 are organization admins)
and 1,000 audit rows. A second `fixture.sh` of the same run prints `reused`.

The loader refuses, without writing, a volume not labelled for this run, a database
that is not new, another run's fixtures or partial fixtures. The remedy is always a new
start of this run's project: `docker compose down -v`, then single-host step 5 again.
Never relabel or adopt an existing volume.

## 4. Admission

Every check must pass before any load. On the generator:

```bash
sh scripts/load-test/admission.sh run
```

It proves that a missing or foreign client certificate is refused, that each request
needs exactly one synthetic IPv4 visitor address, that one visitor is limited after
about the default burst of 50 requests while another visitor is not (API and web app),
and that `X-AMCore-Client-Ip` and `X-Real-IP` are ignored. From a third machine (your
laptop, with an AMCore checkout and a copy of `load-test.env` whose `LT_WORK` is any
existing directory; no certificate or password):

```bash
sh scripts/load-test/admission.sh outside
```

proves that the test entry refuses connections without a certificate and that the
normal edge ignores forged address headers. Each command waits 90 s at the end so the
spent rate budgets refill.

## 5. Measure

On the generator:

```bash
sh scripts/load-test/protocol.sh prepare     # signs in the 200 members once
sh scripts/load-test/protocol.sh smoke       # optional: every action once, not comparable
sh scripts/load-test/protocol.sh campaign    # about 45 minutes
```

The campaign prints the recovery commands first (also in `~/lt-work/out/RECOVERY.txt`).
It runs a 60 s warm-up at 5 iterations/s (not reported), then 5, 10, 20, 30 and 40
iterations/s for 120 s each, three repeats, 30 s apart, with admin reads at 0.2
iterations/s. The first repeat that is not `valid` stops the ladder; a 5 iterations/s
control step follows after 120 s idle. Do not change these values for runs you compare.

One iteration is one visitor action, about 3 HTTP requests. Per 1,200 iterations: 780
authenticated page browses through the web app, 180 public pages, 120 profile updates
(each writes an in-app notification synchronously; this is not a queue test), 60
team-page reads by organization admins and 60 avatar uploads.

## 6. Read the report

`~/lt-work/out/report.md` has one row per step; `manifest.json` records the commit,
image digests, host size, swap and the protocol hash. Results never contain the client
key, cookies or the fixture password.

| Class                 | Meaning                                                                                                                                                | Use it as                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `valid`               | No stop condition, complete data                                                                                                                       | A measured result                                                  |
| `invalid measurement` | Data are missing or broken, the generator CPU saturated, or k6 and the server log disagree beyond 2 %                                                  | Nothing. Fix the cause and repeat the campaign on a fresh host     |
| `observed overload`   | Server p95 above 1 s, more than 1 % failed requests, dropped iterations, a container restart or OOM, or less than 100 MiB available memory on the host | The achieved rate under overload, not capacity at the offered rate |

The **Reference** column compares valid ladder steps with the upper bound published
in Capacity (p95 at most 32 ms at 5, 35 ms at 10 and 900 ms at 20 iterations/s, with
the full offered rate achieved). Lower latency is not a regression. A result outside
the range needs an explanation; run one campaign per fresh host, not repeated runs
until one passes. Every unexpected `429` stays visible in the status column.

What the synthetic addresses prove: each member has its own rate-limit budget, as
200 real visitors would. They do not prove behaviour of real networks, NAT, TLS from
many clients, or traffic from one address, which is limited much earlier.

## 7. Remove the test entry and clean up

On the host, also after any failure, Ctrl-C or lost connection:

```bash
sh scripts/load-test/recover.sh
sh scripts/load-test/remove-check.sh
```

`recover.sh` removes `load-test.yml` from `COMPOSE_FILE` (the previous `.env` is kept in
`~/amcore-load-test/`, outside the checkout) and recreates Caddy with the normal configuration; it is safe
to repeat. `remove-check.sh` must print only `PASS` lines. From another machine,
`curl -m 10 https://app.example.com:8443/` must end with `Failed to connect` or a
timeout (curl exit code 7 or 28) while `curl -m 10 https://app.example.com/` answers.
A TLS or certificate error on 8443 means the test entry still runs. Close port 8443
in the provider firewall.

Then delete what belongs to this run only: `docker compose down -v` in this
project (database, Redis and uploads volumes of `amcore-loadtest-<run id>`), the
directories `/srv/amcore-loadtest` on the host and `~/lt-work` on the generator, and
the VMs if they were created for the test. Do not use `docker system prune` on a
shared host.

## Troubleshooting

| Symptom                                                | Cause and action                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight live`: test-entry peers differ              | The host sees another address than `LOAD_TEST_GENERATOR_IP` (NAT, public vs private address). Set the observed address, `recover.sh`, start again. |
| `clock skew to the host`                               | Enable time synchronisation (NTP) on both VMs. Server times and k6 windows must match within 1 s.                                                  |
| Admission: `other identity` gets `429`                 | The visitor address does not reach the limiter. Check `bff-relay.yml` is in `COMPOSE_FILE` and `COMPOSE_WEB_IPV4` matches `web`.                   |
| A step is `invalid measurement` with `generator CPU`   | Use a larger generator VM; never compare with steps that ran on a saturated generator.                                                             |
| `fixture.sh`: not a fresh database or partial fixtures | `docker compose down -v` in this run's project and repeat from single-host step 5.                                                                 |
