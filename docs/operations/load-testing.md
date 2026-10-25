# Load testing

This guide repeats the reference measurement in [Capacity](capacity.md) on a host
you control: same traffic mix, same steps, same result rules. Use it when one of the
triggers in [Capacity → When to measure again](capacity.md#when-to-measure-again)
applies, or before you rely on the published numbers for a different host class.
Measure the commit you want to evaluate; the report compares it with the published
range.

> **Never run this on a production deployment.** The test entry lets the holder of
> the test client certificate choose any visitor address in `198.18.0.0/15`, so the
> per-address rate limits stop protecting that path, and the fixtures add accounts.
> Use a disposable host, a disposable database and a temporary certificate, and
> remove the entry afterwards. The scripts refuse an ordinary deployment (wrong
> project name, a database that is not new), but they cannot recognise production
> in every case: never rename or adapt one to pass them.

## What you need

- **Host:** a disposable Linux host prepared with the prerequisites of the
  [single-host guide](single-host-compose.md#before-you-start) (Docker, DNS for two
  names, ports 80 and 443). For numbers comparable with Capacity: 2 vCPU with a 100 %
  guaranteed share, 2 GiB RAM, not preemptible, swap off while measuring.
- **Generator:** a second Linux VM in the same region and private network with Docker,
  `curl`, `openssl`, `tmux`, access to Docker Hub (k6 runs from a pinned image), and an
  AMCore checkout of the same commit. It needs SSH key access to the host. Its CPU must
  not saturate; the report marks a step invalid when it does. 2 vCPU is enough for the
  reference steps.
- **Time:** time synchronisation (NTP) on both VMs; the steps refuse a clock skew
  above 1 s.
- **Topology:** the product web edge in path mode, as in the single-host guide, with the
  bundled Postgres. `PROJECT_CONTEXT.md` must show `admin_console_mode: path` or no
  Console at all; a Console on its own host (`host`) and external databases are not
  supported, and `preflight.sh` refuses them. Locale routing is supported.
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

`ca.key` is deleted at once: no further certificate can be issued. On the host, create
the two directories as the user who runs `docker compose`, then copy the files from
the generator:

```bash
mkdir -p -m 700 /srv/amcore-loadtest/ca /srv/amcore-loadtest/secrets      # host
scp ~/lt-work/ca.crt <user>@<host>:/srv/amcore-loadtest/ca/                # generator
scp ~/lt-work/fixture-password <user>@<host>:/srv/amcore-loadtest/secrets/  # generator
```

The client key never leaves the generator.

## 2. Plan the deployment on the host

Follow the single-host guide steps 1–4 (source, database certificates, `.env`,
images). On a disposable host you may delete the database CA key instead of storing
it offline. Set these keys **before step 5**, so the database volume is created for
this run only; this `COMPOSE_FILE` replaces the one from single-host step 1:

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

- `LOAD_TEST_RUN_ID`: 4–32 lowercase letters or digits, new for every campaign. The
  project name must be `amcore-loadtest-<run id>`. A fresh host is a new VM, or the
  same VM after `docker compose down -v` of the previous run (section 7).
- `LOAD_TEST_GENERATOR_IP`: one IPv4 address, usually the generator's private address
  in the same network. Ranges and IPv6 are refused.
- Mock email: the test sends no mail; no provider key is needed.

Also build the fixture loader: `sh scripts/load-test/fixture.sh build`
(it reuses the API build stage). If you added swap for the build, switch it off now
(`sudo swapoff -a`; `swapon --show` prints nothing); the report records the swap state.
Then check the plan; it changes nothing:

```bash
sh scripts/load-test/preflight.sh plan
```

Expected result: `preflight plan: ok (run …, project …, route prefix '/en', generator …)`.
Note the route prefix (empty for a single-locale project). Fix every refusal before
you continue.

## 3. Start the run's project and load the fixtures

Run single-host steps 5–7 unchanged (step 8 is a useful check; backups are not needed).
Then, on the generator, create `load-test.env` in the checkout root (or anywhere, with
`LT_ENV=<path>` before each command):

```bash
LT_WORK=$HOME/lt-work
LT_SERVER_SSH=<user>@<host address>
LT_SERVER_DIR=/srv/amcore
LT_WEB_HOST=app.example.com
LT_API_HOST=api.example.com
LT_SERVER_IP=<host address the generator connects to>
LT_PREFIX=/en
```

`LT_SERVER_IP` is the host address the generator connects to, usually its private
address; the scripts send both names to it directly, so DNS is not used. `LT_PREFIX`
is the route prefix that `preflight.sh plan` printed (empty without locale routing).
Then send one probe from the generator checkout, then check the live deployment and load
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

Before the first write, `fixture.sh` proves the target: the database volume carries this
run's label, every rendered database URL (API, worker, migration, loader) points at this
project's `postgres` over `verify-full` TLS, the running postgres container stores its
data in that volume, and the running API, worker and web containers use exactly the
configured database and API URLs on the same network. A container created from an older
`.env` fails this check: recreate it (`docker compose up -d --force-recreate <service>`)
before loading fixtures. The scripts read the project, files and URLs only from `.env`;
variables exported in your shell (for example `COMPOSE_PROJECT_NAME`) are ignored, with a
warning that names them.

The loader refuses, without writing, a target that fails this proof, a database that is
not new, another run's fixtures or partial fixtures. The remedy is always a new start of
this run's project: `docker compose down -v`, then single-host step 5 again. Never
relabel or adopt an existing volume.

## 4. Admission

Every check must pass before any load. On the generator:

```bash
sh scripts/load-test/admission.sh run
```

It proves, on both test domains, that a missing or foreign client certificate is
refused; that each request needs exactly one synthetic IPv4 visitor address; that one
visitor is limited after about the default burst of 50 requests while another visitor
is not (API and web app); and that `X-AMCore-Client-Ip` and `X-Real-IP` are ignored.

Then, from a machine that is not the generator (for example your laptop with `curl` and
an AMCore checkout of the same commit; macOS and Linux shells both work), check the
normal edge through public DNS. Create a private directory with a copy of
`fixture-password`, and a `load-test.env` with only `LT_WORK=<that directory>`,
`LT_WEB_HOST`, `LT_API_HOST` and `LT_PREFIX` (no `LT_SERVER_IP`, so the names resolve
publicly):

```bash
LT_ENV=<path>/load-test.env sh scripts/load-test/admission.sh outside
```

It proves that forged address headers on the normal edge change no rate budget, for the
API and through the web app (member 197 signs in). Both paths reach the same API
handler, so one real address may have one shared budget for both: the web check starts
after a 45 s refill pause. Its first line only shows that the test entry is not open to
this machine: the firewall drop or a TLS refusal both pass there; the certificate proof
is `run` above. Each command waits 90 s at the end so the spent rate budgets refill.

## 5. Measure

On the generator, inside `tmux`, so a dropped SSH session does not stop the run:

```bash
sh scripts/load-test/protocol.sh prepare     # signs in the 200 members once
sh scripts/load-test/protocol.sh smoke       # optional: every action once, not comparable
sh scripts/load-test/protocol.sh campaign    # about 45 minutes
```

`prepare` keeps the members' live session cookies in `~/lt-work/sessions.json`; delete
it with `~/lt-work` at the end. `smoke` writes to `~/lt-work/out-smoke` and can run any
number of times; each run adds a step `smoke-<time>` to that report, and it never blocks
the campaign. It uses the prepared sessions (no new `prepare`) and adds only a few dozen
rows. A smoke step is `valid` only when every action answered with its expected status. The campaign writes to `~/lt-work/out` and
prints the recovery commands first (also in `~/lt-work/out/RECOVERY.txt`). A second
campaign needs a new `LT_WORK` (and, to be comparable, a fresh host).

The campaign runs a 60 s warm-up at 5 iterations/s (in the report, not compared), then
5, 10, 20, 30 and 40 iterations/s for 120 s each, three repeats, 30 s apart, with admin
reads at 0.2 iterations/s. A warm-up that is not `valid` stops before any step; the
first repeat that is not `valid` stops the ladder; a 5 iterations/s control step
follows after 120 s idle. Iterations still running when a step ends are interrupted,
so the counted requests and the server log cover the same window. Do not change these
values for runs you compare.

One iteration is one visitor action, about 3 HTTP requests. Per 1,200 iterations: 780
authenticated page browses through the web app, 180 public pages, 120 profile updates
(each writes an in-app notification synchronously; this is not a queue test), 60
team-page reads by organization admins and 60 avatar uploads.

## 6. Read the report

`~/lt-work/out/report.md` has one row per step. Its header names the run id and the
commit, and states whether host and generator ran the same commit and the same harness
(scripts, k6 scenarios, avatar file); a `NO` there makes the campaign unusable.
`manifest.json` adds image digests, host and generator size, swap and the protocol
parameters. Whether the host class and data match Capacity is your comparison of those
fields, not something the scripts prove. The `out` directory never contains the client
key, cookies or the fixture password, so you can share it.

| Class                 | Meaning                                                                                                                                                                                                                                                                | Use it as                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `valid`               | No stop condition, complete data                                                                                                                                                                                                                                       | A measured result                                                  |
| `invalid measurement` | Data are missing or broken: host or generator samples do not cover the whole step, an action has no server records, k6 and the server log disagree by more than the requests in flight and the measured clock skew allow, or the generator CPU saturated (idle < 10 %) | Nothing. Fix the cause and repeat the campaign on a fresh host     |
| `observed overload`   | Server p95 above 1 s, more than 1 % failed requests overall or of the admin reads, dropped iterations, a container restart, recreation or OOM, or less than 100 MiB available memory on the host                                                                       | The achieved rate under overload, not capacity at the offered rate |

The report also lists failed checks per action (an unexpected status) and every status
code the server saw.

The **Reference** column compares valid ladder steps with the upper bound published
in Capacity, which counts requests: 5, 10 and 20 iterations/s are about 16, 31 and 61
requests/s, with p95 at most 32 ms, 35 ms and 900 ms and at least 98 % of the
offered rate achieved. Lower latency is not a regression. Each step is classified on
its own data: report the `valid` steps as results, also those before a later stop; a
campaign that stopped early has no result for the steps after the stop.

- An `invalid measurement` gives no result for its step and stops the ladder: fix its
  cause (for example a larger generator) and run a new campaign on a fresh host with a
  new run id to measure the remaining steps.
- A valid result outside the range needs an explanation. Do not repeat campaigns until
  one passes.
- Every unexpected `429` stays visible in the status column.

What the synthetic addresses prove: each member has its own rate-limit budget, as
200 real visitors would. They do not prove behaviour of real networks, NAT, TLS from
many clients, or traffic from one address, which is limited much earlier.

## 7. Remove the test entry and clean up

On the host, also after any failure, Ctrl-C or lost connection to the generator (the
host needs nothing from the generator for this):

```bash
sh scripts/load-test/recover.sh
sh scripts/load-test/remove-check.sh
```

`recover.sh` removes `load-test.yml` from `COMPOSE_FILE` (the previous `.env` is kept in
`~/amcore-load-test/`, outside the checkout) and recreates Caddy with the normal
configuration; it is safe to repeat. A campaign still running on the generator then
fails its next step as `invalid measurement`. `remove-check.sh` must print only `PASS`
lines, among them `:8443 refuses connections`; this host-side proof is enough when the
generator is unreachable. When it is reachable, prove it from there too, through the
same address the load used (the firewall admits only the generator on 8443):

```bash
sh scripts/load-test/admission.sh removed      # generator
```

It must print only `PASS` lines: 8443 refuses the connection (curl exit code 7, a closed
port; a TLS or certificate error would mean the test entry still runs), the normal site
answers (so the host is reachable), and forged address headers on the normal edge
change no rate budget for the API and the web app. Then close port 8443 in the provider
firewall. If something goes wrong you may close it first, as soon as possible; `removed`
then sees a timeout instead of a refused connection and fails its first check, so rely
on `remove-check.sh` on the host for that proof.

Then delete what belongs to this run only, after `remove-check.sh` has passed:

```bash
docker compose ls                                       # this project: amcore-loadtest-<run id>
docker compose down -v                                  # its containers, network and volumes
docker volume ls --filter label=com.docker.compose.project=amcore-loadtest-<run id>   # empty
```

Run these from the deployment checkout: `recover.sh` keeps `COMPOSE_PROJECT_NAME` in
`.env`, so `docker compose` still names this run's project. Also delete
`/srv/amcore-loadtest` and `~/amcore-load-test` on the host, `~/lt-work` on the generator
(keep a copy of `~/lt-work/out` if you want the results), the `fixture-password` copy on
the machine that ran `outside`, and the VMs if they were created for the test. Do not use `docker system prune` on a shared host.

## Troubleshooting

| Symptom                                                | Cause and action                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight live`: test-entry peers differ              | The host sees another address than `LOAD_TEST_GENERATOR_IP` (NAT, public vs private address). Set the address it printed in `.env`, run `docker compose up -d --force-recreate --no-deps caddy`, then the probe and `preflight.sh live` again. |
| `clock skew to the host`                               | Enable time synchronisation (NTP) on both VMs. Server times and k6 windows must match within 1 s.                                                                                                                                              |
| Admission: `other identity` gets `429`                 | The visitor address does not reach the limiter. Check `bff-relay.yml` is in `COMPOSE_FILE` and `COMPOSE_WEB_IPV4` matches `web`.                                                                                                               |
| A step is `invalid measurement` with `generator CPU`   | Use a generator VM with twice the vCPUs and run a new campaign on a fresh host; never compare with steps that ran on a saturated generator.                                                                                                    |
| `fixture.sh`: not a fresh database or partial fixtures | `docker compose down -v` in this run's project and repeat from single-host step 5.                                                                                                                                                             |
