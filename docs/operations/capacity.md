# Capacity

This page gives measured reference numbers for one small host. Use them to choose a
starting size, not as a guarantee: your traffic mix, data volume and features differ.
Measure your own workload before you rely on a number.

## Reference measurement

| Item     | Value                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code     | AMCore at commit `796952fe`, October 2026                                                                                                                                                                                                                  |
| Host     | 2 vCPU with a 100 % guaranteed share, 2 GiB RAM, network SSD, no swap while measuring                                                                                                                                                                      |
| Stack    | The [single-host recipe](single-host-compose.md): all services, bundled Postgres, Redis and Caddy on one host                                                                                                                                              |
| Data     | Small: a few thousand rows per table                                                                                                                                                                                                                       |
| Load     | A separate load-generator VM in the same cloud region, open arrival rate                                                                                                                                                                                   |
| Visitors | 200 signed-in members, each with its own session. All traffic came from the one generator VM; each member carried its own synthetic visitor address, accepted only through an isolated test entry point, so the per-address rate limits applied per member |

Each iteration was one visitor action, about 3 HTTP requests on average. Per 1,200
iterations: 780 page browses through the web app (authenticated reads), 180 public
pages, 120 profile updates with an in-app notification, 60 team-page reads and 60
avatar uploads. Each step ran 120 s after a 60 s warm-up, three times where the
results allowed. Times are server-side (edge access log), from request to response.

| Rate (requests/s) | Server p95 | Errors | Result                                                                         |
| ----------------- | ---------- | ------ | ------------------------------------------------------------------------------ |
| ≈ 16              | 30–32 ms   | 0      | Stable (3 runs)                                                                |
| ≈ 31              | 33–35 ms   | 0      | Stable (3 runs)                                                                |
| ≈ 61              | 0.13–0.9 s | 0      | At the limit; large variation between runs (5 runs, one with container limits) |
| ≈ 90 offered      | > 6 s      | 0      | Overloaded: the generator could not reach the rate                             |

- The limit is CPU: at ≈ 61 requests/s the web app and the API together use both
  vCPUs. A host with more CPU is the first step to grow.
- Memory was not the limit. Peak container memory: API ≈ 530 MiB, worker ≈ 380 MiB,
  web ≈ 350 MiB, Postgres ≈ 100 MiB, Caddy ≈ 120 MiB, Redis < 10 MiB. Available host
  memory stayed above 160 MiB, also when overloaded.
- After the overload, the stack returned to normal response times within 2 minutes
  without restarts.
- Avatar upload is the slowest action (image re-encoding): p95 about 1 s at
  ≈ 61 requests/s.
- Not measured: bursts of sign-ins, live update streams (SSE), real email or AI
  providers, large data sets, and hosts with a shared CPU (a guaranteed share below
  100 %). Real traffic from one address or one NAT is limited by the per-address
  rate limits much earlier than these rates.

## Building the images

Building needs much more memory than running. In the reference run, the web build
alone used about 3 GB of Node.js heap, and the build needed about 4.6 GB of RAM plus
swap in total. A 2 GiB host without help fails with `JavaScript heap out of memory`.

- Preferred: build in CI or on another machine, and pull the images
  ([registry rollout](deployment.md#production-rollout-via-registry-image-pull-path)).
- On a small host: add swap and set `BUILD_NODE_OPTIONS=--max-old-space-size=3072` in
  `.env`. Node.js sizes its default heap from physical RAM, so swap alone does not
  help. The option applies to the build stage only, not to the running containers.
- Build one service per command. Parallel builds multiply the memory need.

## Redis memory

Configure Redis with `maxmemory` and the `noeviction` policy
([Redis production profile](deployment.md#redis-production-profile)). In the
reference run, Redis was filled to its limit on purpose:

- Existing sessions kept working. New sign-ins and registrations got `503`, and the
  API readiness check reported `503`. No service crashed or restarted.
- Two welcome emails queued before the limit stayed queued and were sent after
  memory was freed. Everything recovered without restarts.
- Registration under this pressure can end in the created-account notice
  (`REGISTRATION_SIGN_IN_REQUIRED`: the API confirmed the account but the session could not
  be stored) or in an unavailable or uncertain result (`5xx`, `503`, a lost connection).
  Known refusals (invalid fields, closed signup, rate limit, email taken) keep their own
  messages. After the notice or an uncertain result, wait until Redis accepts writes, then
  sign in with the chosen password or reset it. A failed sign-in does not show that the
  account is absent, and sign-in also fails while Redis refuses writes; see
  [registration results](../frontend/api-consumption.md#registration-results-in-the-web-application).
- The welcome email is queued in Redis and is best-effort: with Redis full the queue refuses it,
  so it is lost, and it has no resend. The verification email is sent directly and can be
  requested again; see [queued email](../email/delivery.md#queued-email).

## Container memory limits

Container limits stop one service from taking the memory of the others. They are
ceilings, not reservations: if several services grow at the same time, the host can
still run out of memory.

This set ran the reference load at ≈ 61 requests/s without an out-of-memory kill. Its
total (2,368 MiB) is above the host's RAM, so it is only a starting point:

| Service  | `mem_limit` | Note                                   |
| -------- | ----------- | -------------------------------------- |
| api      | 768m        | Peak ≈ 530 MiB                         |
| worker   | 512m        | Peak ≈ 380 MiB                         |
| web      | 512m        | Peak ≈ 350 MiB                         |
| postgres | 256m        |                                        |
| redis    | 160m        | With `maxmemory 96mb` and `noeviction` |
| caddy    | 160m        |                                        |

Node.js inside a limited container sizes its heap from the limit by itself; a
`--max-old-space-size` flag is not required.

What happens when a service reaches its limit (each tested on the reference host
with the restart policies of `docker/compose/supervise.yml`):

| Service | Observed result                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web     | Killed and restarted; during the restarts about 12 % of requests got `502`. No data is lost: sessions live in Redis.                                                   |
| worker  | Restarts in a loop while the limit is too low. Three jobs queued during the loop waited and completed once the limit was raised. Repeated deliveries were not checked. |
| api     | Restarts in a loop; the API answers `502` until the limit is raised. Back in about 15 s after that.                                                                    |

So set each limit with headroom over its measured peak, and alert on container
restarts. In adjacent runs with and without limits, any cost of the limits could
not be separated from the variation between runs.

## When to measure again

Measure again before relying on these numbers after a Next.js or NestJS major
upgrade, a new always-on module or background job, a change of process roles, a
failed route budget check, or a different host class. [Load testing](load-testing.md)
repeats this measurement with the same mix, steps and result rules.
