# Luji Land

A daycare management system: enrolling children, recording the day, keeping
guardians updated.

**A learning project** for microservices: seven services, each owning its
capability and its own database, talking only over HTTP and Kafka.

---

## Services

| Service | What it does | Lang | Port |
| :--- | :--- | :--- | :--- |
| **Gateway** | The only door in — authenticates, rate limits, forwards. Stores nothing. | TS | 3000 |
| **Directory** | Who exists and where they belong: classrooms, children, staff, tokens, enrollment. | TS | 3001 |
| **Care records** | What happened to a child today: check-ins, meals, naps, notes. | Python | 3002 |
| **Media** | Photos, videos, consent forms — upload and background processing. | Python | 3003 |
| **Notifications** | Tells guardians things; survives a broken email provider. | TS | 3004 |
| **AI assistant** | Undecided. Port reserved, nothing else. | Python | 3005 |
| **Reports** | Attendance and meal totals, rebuilt by replaying history. | Python | 3006 |

---

## Architecture

```
                          browser
                             │
                          Gateway ──────── Redis (cache, rate limit, jobs)
                             │
     ┌───────────┬───────────┼───────────┬──────────┐
  Directory  Care records    │      Notifications  Reports     Media
    (pg)         (pg)        │          (pg)        (pg)     (pg + S3)
     └───────────┴─── Kafka ─┴───────────┴──────────┘
```

**The gateway authenticates, rate-limits, and forwards — nothing else.** It
never composes a response from several services. The browser calls services
individually, so one outage degrades part of a page instead of all of it.

**Kafka carries everything that leaves a service.** Two uses, one broker:

- **Domain events** — "this happened," retained, so a new consumer or a
  rebuilt Reports replays history instead of needing a bespoke backfill.
- **Task topics** — "do this one job" handed to a *different* service
  (Notifications sends an email, Media transcodes). One topic per job type,
  a consumer group per worker pool, a `.dlq` twin for poison messages.

Work a service defers to *itself* never touches the broker — it goes to
Redis (BullMQ/arq).

### Rules

1. **No service imports from another.** HTTP or Kafka, never shared code.
2. **One database per service.** Nobody reads another's tables.
3. **A service survives its neighbours going down** — keep a local copy of what you depend on.
4. **Every message handler is idempotent.**
5. **Contracts live in `contracts/` as JSON Schema**, owned by neither language.
6. **Config is validated at startup** — a missing setting refuses to boot.
7. **Comments explain *why*, not what.**

### Stack

| Layer | Choice |
| :--- | :--- |
| Frontend | React + TypeScript, talks only to the gateway |
| TS services | Node 22 + NestJS on Fastify |
| Python services | Python 3.13 + FastAPI |
| Database | PostgreSQL 17, one per service |
| Migrations | Prisma (TS), Alembic (Py) |
| Events + cross-service tasks | Kafka |
| Cache + in-service jobs | Redis, persistence on — BullMQ (TS), arq (Py) |
| Files | S3 API, MinIO locally |
| Tracing | OpenTelemetry → Jaeger |
| Containers | Docker + compose |
| Commands | `make` |

**Two languages, split by workload.** TypeScript takes the rule-heavy
services, Python the processing-heavy ones. Care records is the busiest and
is Python by design — it's where most of the practice is.

### Testing

Tests run against real Postgres and Kafka via Testcontainers — a fake
database hides exactly the bugs this project exists to learn about. **Killing
a service mid-request is a test case**, not a manual check. `make test` runs
all of it.

Deliberately excluded options are in [EXTRAS.md](EXTRAS.md).

---

## Phases

Seven phases, in this order. Each is a working system before the next
starts — build the steps top to bottom, and the phase is finished when
its **Done when** holds. Patterns are listed with the phase that forces
them; the full story is written when work on that phase starts.

### 1. Directory + Care records + Kafka

Hardest part first: two services surviving each other's downtime. Brings up the
broker, because every pattern below needs it. Full PRD:
[#1](https://github.com/mahmod-labs/luji-land/issues/1).

### 2. Gateway + Redis

One entrance, login end to end.

1. Directory issues signed JWTs and publishes its public key.
2. Gateway (NestJS): verify, rate limit, forward. No response composing.
3. Every service verifies tokens locally — nobody calls Directory to authorize.
4. Redis cache-aside on Directory reads, invalidated on write.
5. Revocation list in Redis, fed by a Kafka event.
6. Token bucket per client in the gateway.

| Pattern | Problem it solves |
| :--- | :--- |
| API gateway | Auth, rate limits, routing in one place, not seven |
| Stateless token verification | Every service authorizes without calling Directory |
| Permission change by event | A revoked access must stop working immediately |
| Cache-aside + explicit invalidation | A list goes stale right after a write |
| Cache stampede lock | Cache expires; many clients hit the database at once |
| Fail-open degradation | Redis goes down; nothing may error out |
| Token-bucket rate limiting | One client can't starve everyone else |

**Done when:** Redis is stopped and requests still succeed; a revoked token
fails on its *next* request, not after a cache expires.

### 3. Notifications + jobs

Messaging as real infrastructure.

1. Notifications consumes domain events, decides what's worth sending.
2. Sends go through a BullMQ queue on Redis — never inline in the consumer.
3. Retry with backoff, circuit breaker around the email provider.
4. Failed messages land on the topic's `.dlq` twin.
5. Separate worker pools so email can't monopolise the service.

| Pattern | Problem it solves |
| :--- | :--- |
| Retry with backoff + circuit breaker | The email provider is slow, then broken |
| Dead-letter topic | One poison message shouldn't block the topic |
| Durable job queue | A restart must not lose waiting jobs |
| Consumer group rebalance | A worker dies holding a job |
| Bulkhead | A flood of email jobs must not starve check-ins |

**Done when:** a provider that returns 500 for an hour loses nothing, and
check-ins are unaffected throughout.

### 4. Enrollment

A saga that can fail halfway.

1. A saga table in Directory: one row per enrollment, its current step.
2. Each step has a compensating action written at the same time as the step.
3. A sweeper job abandons enrollments stuck waiting too long.
4. A `rebuild-replica` command that re-reads source of truth from the log.

| Pattern | Problem it solves |
| :--- | :--- |
| Saga with compensation | A crash halfway must not leave an orphaned account |
| Process manager / state machine | A long signup remembers where it got to |
| Timeout + abandon | A consent form that's never signed |
| Replica rebuild from source | A copy has been wrong for weeks |

**Done when:** killing the service mid-saga leaves no half-created child —
compensations run on restart.

### 5. Reports

The first thing needing full history and replay.

1. Reports consumes from offset 0 and builds a read model — no writes of its own.
2. Events are stored, not just their result.
3. A correction is a new event; nothing is ever updated in place.

| Pattern | Problem it solves |
| :--- | :--- |
| Event log replay | The whole Reports database is deleted |
| CQRS read model | Reporting queries shouldn't hit the write side |
| Event sourcing | State alone can't answer "was this corrected later?" |
| Corrections, not deletes | A recorded time was wrong yesterday |

**Done when:** the Reports database is dropped, replayed from Kafka, and the
totals match what they were.

### 6. Media

Uploads and background processing.

1. Media hands out presigned S3 URLs; the file goes browser → MinIO directly.
2. The event carries the object key, never the bytes.
3. An arq job transcodes after the upload request has already returned.

| Pattern | Problem it solves |
| :--- | :--- |
| Presigned upload | A large file must never pass through a service |
| Claim check | Big payloads don't belong in messages |
| In-service deferred work | Transcoding takes too long for the upload request to wait on |

**Done when:** a 400 MB video uploads without the service's memory moving.

### 7. Split Directory

Big enough by now to be worth strangling — goes last.

1. Carve Billing out of Directory into its own service and database.
2. Gateway routes old paths to whichever side owns them, one at a time.
3. Old routes keep working the entire way through.

| Pattern | Problem it solves |
| :--- | :--- |
| Strangler fig | Directory outgrew itself — carve it apart with no cutover |

**Done when:** Billing is a separate service and no request ever 404'd during
the move.

---

## Scenarios it must survive

Each becomes an acceptance scenario on the issue for the phase that makes it
possible.

| Scenario | What must hold |
| :--- | :--- |
| A teacher checks a child in while Directory is down | Care records uses its replica; the check-in succeeds and reconciles later |
| A tablet loses signal mid check-in and retries | The second delivery has no effect — no duplicate record |
| The 20th and 21st child enrol in one room in the same second | Exactly one succeeds; the room never exceeds its limit |
| The email provider is down for an hour | Notifications queues and retries; nothing dropped, no other service affected |
| A guardian's access is revoked mid-session | Their *next* request is rejected, not the one after a cache expires |
| Redis is switched off during business hours | The gateway keeps routing; caching and rate limits degrade, requests don't fail |
| Reports' database is lost entirely | Rebuilt from the Kafka log alone, no manual data entry |
| An enrollment saga fails after Directory succeeds, before billing | The Directory record is compensated away — no half-created child |
| A 400 MB video is uploaded | Straight to storage; no service process holds the file in memory |
| Directory is split and Billing carved out | Old and new routes both work throughout, no maintenance window |
