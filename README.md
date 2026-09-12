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

Each one works before the next starts.

| Build | Why here |
| :--- | :--- |
| **1. Directory + Care records + Kafka** | Hardest part first: two services surviving each other's downtime. Brings up the broker, because every pattern here needs it. |
| **2. Gateway + Redis** | One entrance, login end to end |
| **3. Notifications + jobs** | Messaging as real infrastructure |
| **4. Enrollment** | A saga that can fail halfway |
| **5. Reports** | The first thing needing full history and replay |
| **6. Media** | Uploads and background processing |
| **7. Split Directory** | Big enough by now to be worth strangling — goes last |

---

## Patterns

One pattern per row, one problem forcing it. Full story and acceptance
criteria get written when work on it starts. This table is not a backlog.

### 1. Directory + Care records + Kafka

| Pattern | Problem it solves |
| :--- | :--- |
| Event-driven communication | Directory publishes, doesn't call Care records directly |
| Local replica / data duplication | Directory is down at drop-off; check-ins still work |
| Catch-up consumer | Care records was off all night, missed enrollments |
| Idempotent consumer | The broker redelivers an already-handled message |
| Idempotency key | A double-tapped check-in on a stalled network |
| Eventual consistency, explicit | The replica lags the write by a couple seconds |
| DB-side constraint / optimistic concurrency | A room must never exceed capacity, even under a race |
| Transactional outbox | A write commits but its event is lost on crash |
| Event ordering by occurrence time | "Withdrawn" arrives before "enrolled" |

Client-generated ids and records carrying the time they happened are decided
here — they are expensive to retrofit and are what offline sync will need.

### 2. Gateway + Redis

| Pattern | Problem it solves |
| :--- | :--- |
| API gateway | Auth, rate limits, routing in one place, not six |
| Stateless token verification | Every service authorizes without calling Directory |
| Permission change by event | A revoked access must stop working immediately |
| Cache-aside + explicit invalidation | A list goes stale right after a write |
| Cache stampede lock | Cache expires; many clients hit the database at once |
| Fail-open degradation | Redis goes down; nothing may error out |
| Token-bucket rate limiting | One client can't starve everyone else |

### 3. Notifications + jobs

| Pattern | Problem it solves |
| :--- | :--- |
| Retry with backoff + circuit breaker | The email provider is slow, then broken |
| Dead-letter topic | One poison message shouldn't block the topic |
| Durable job queue | A restart must not lose waiting jobs |
| Consumer group rebalance | A worker dies holding a job |
| Bulkhead | A flood of email jobs must not starve check-ins |

### 4. Enrollment

| Pattern | Problem it solves |
| :--- | :--- |
| Saga with compensation | A crash halfway must not leave an orphaned account |
| Process manager / state machine | A long signup remembers where it got to |
| Timeout + abandon | A consent form that's never signed |
| Replica rebuild from source | A copy has been wrong for weeks |

### 5. Reports

| Pattern | Problem it solves |
| :--- | :--- |
| Event log replay | The whole Reports database is deleted |
| CQRS read model | Reporting queries shouldn't hit the write side |
| Event sourcing | State alone can't answer "was this corrected later?" |
| Corrections, not deletes | A recorded time was wrong yesterday |

### 6. Media

| Pattern | Problem it solves |
| :--- | :--- |
| Presigned upload | A large file must never pass through a service |
| Claim check | Big payloads don't belong in messages |
| In-service deferred work | Transcoding takes too long for the upload request to wait on |

### 7. Splitting Directory

| Pattern | Problem it solves |
| :--- | :--- |
| Strangler fig | Directory outgrew itself — carve it apart with no cutover |

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
