# Luji Land

A daycare management system. Staff enroll children, record the day, keep
guardians updated.

Built to practise microservices and distributed systems. **A learning project,
not a product** — when a simpler design teaches nothing, we take the harder one
that teaches something. Six services for one daycare is too many for a real
product and exactly right for practice.

Nothing is built yet.

## How this is run

| Where | What lives there |
| :--- | :--- |
| **This README** | Everything that doesn't change week to week: design, stack, patterns. |
| **Milestones** | The 8 phases. |
| **Issues** | The one thing being built right now. Its body is that service's PRD. |
| **Releases** | `v0.N` when phase N's milestone closes. |

Rules I hold myself to:

- **One open issue at a time.** Two means the second hasn't started.
- **A service is specified when it's built**, not before — one sentence until then.
- **A pattern below becomes an issue only when I start it.** The table is not a backlog.
- One repo, one service per capability, never a shared database.

---

## Architecture

### Rules

1. **No service imports from another service.** HTTP and the broker only.
2. **One database per service.** No service ever reads another's tables.
3. **A service stays up when its neighbours are down.** Keep a local copy of what you need.
4. **Every message handler is safe to run twice.**
5. **Contracts live in `contracts/` as JSON Schema** — owned by neither language.
6. **Config is validated at startup.** Missing setting = refuse to boot, never a silent default.
7. **Comments explain _why_.**

### Shape

```
        browser
           │
        Gateway ──────── Redis (cache, rate limit, jobs)
           │
   ┌───────┼───────┬────────────┬────────┐
Directory  Care  Notifications Reports  Media
  (pg)    (pg)      (pg)        (pg)    (pg+S3)
   └───────┴───────┴──── RabbitMQ ──┴───────┘
                          │
                        Kafka ──► Reports (replay)
```

The gateway **routes, it does not compose**. The browser makes several calls, so
one dead service breaks one part of the page instead of all of it.

### Services

One sentence each, on purpose.

| Service | Lang | Port | What it does |
| :--- | :--- | :--- | :--- |
| **Gateway** | TS | 3000 | The only door in — authenticates, rate limits, forwards; stores nothing. |
| **Directory** | TS | 3001 | Who exists and where they belong: classrooms, children, staff, enrollment, tokens. |
| **Care records** | Python | 3002 | What happened to a child today: check-ins, meals, naps, notes. |
| **Media** | Python | 3003 | Photos, videos, consent forms — upload and background processing. |
| **Notifications** | TS | 3004 | Tells guardians things, survives a broken email provider. |
| **AI assistant** | Python | 3005 | Undecided. Port reserved, nothing else. |
| **Reports** | Python | 3006 | Attendance and meal totals, rebuilt by replaying the whole history. |
| **Enrollment** | TS | — | The multi-step signup that crosses services and can be cancelled halfway. |

---

## Tech stack

| Layer | Choice | Why |
| :--- | :--- | :--- |
| Frontend | React + TypeScript | Separate app, talks only to the gateway |
| TS services | Node 22 + NestJS on Fastify | Structure built in, so we argue about architecture not folders |
| Python services | Python 3.13 + FastAPI | Async by default — suits the file and message work |
| Database | PostgreSQL 17 | One per service. Also good enough to be a job queue. |
| Migrations | Prisma (TS), Alembic (Py) | Standard in each language |
| Messaging | RabbitMQ | Retries, dead letters, routing built in, and a UI you can watch |
| Cache / jobs | Redis | Caching, counters, locks, queues. Persistence **on** — jobs live here. |
| Job queues | BullMQ (TS), arq (Py) | Standard in each language |
| Event log | Kafka | Keeps events after reading, so Reports can be rebuilt |
| Files | S3 API, MinIO locally | Same API locally as in the cloud |
| Tracing | OpenTelemetry → Jaeger | Follow one request across every service |
| Containers | Docker + compose | One image per service |
| Commands | `make` | The only tool that runs both npm and Python things |

**Two languages on purpose.** TypeScript takes the rule-heavy parts (Directory,
gateway, notifications). Python takes the async, processing-heavy parts (care
records, media, AI). Care records is the busiest service and is Python
deliberately — most practice.

### Deliberately not using

| Not | Instead | Why |
| :--- | :--- | :--- |
| Redis for the outbox | Postgres | The outbox needs data + message in **one transaction**. Redis can't join a Postgres transaction. |
| Celery | arq | arq is async like the rest of our Python |
| CDC / Debezium | A loop over unsent rows | Forty lines you can read in full |
| Kubernetes | compose | Maybe at the very end |
| GraphQL | REST | One less thing between us and the topic |
| Separate auth provider | Directory issues tokens | Fewer moving parts, same lesson |
| Service mesh | Nothing | Solves problems we don't have |

Also skipped: BFF, sidecars, blue-green.

Kafka does **not** replace RabbitMQ. Events go to both — RabbitMQ for
handle-once consumers, Kafka for Reports, which needs the whole history and to
re-read it.

### Testing

Real Postgres and RabbitMQ via Testcontainers — a fake database hides exactly
the bugs we're here to learn about. **Turning a service off is a test**, not
something you remember to try by hand. One command: `make test`.

### Open decisions

| Question | Now | Why |
| :--- | :--- | :--- |
| Token storage | Local storage | Simplest. XSS reads it, so: short expiry, nothing sensitive inside. First thing to revisit if this ever went real. |
| Photo/record retention | 1 year, per-customer setting | Defensible, changeable without a rebuild |
| What the AI service does | Open | Decided in phase 7 |

---

## Phases

| Milestone | Build | Why here |
| :--- | :--- | :--- |
| **v0.1** | Directory + Care records | Hardest part first: two services that survive each other being down. |
| **v0.2** | Gateway + Redis | One entrance, login end to end, caching and rate limits. |
| **v0.3** | Notifications + jobs | Proves messaging is real infrastructure. |
| **v0.4** | Enrollment | A long process across services that can fail halfway. |
| **v0.5** | Reports + Kafka | First thing that needs the *whole* history, and to be rebuilt from it. |
| **v0.6** | Media | Uploads and heavy background work. |
| **v0.7** | Split Directory | Needs a service big enough to be worth strangling, so it goes last. |
| **v0.8** | AI assistant | Last, if still wanted. |

Each one works before the next starts.

---

## Patterns

Each row is **one design pattern** and **the problem that forces it**. A row
becomes a GitHub issue when I start it — and only then. The full story and
acceptance criteria get written in that issue's body.

Cast: **Maya** a child, **Sara** her guardian, **Dana** a teacher,
**Sunflowers** a classroom for 20.

### v0.1 — Directory + Care records

| Pattern | Problem it solves |
| :--- | :--- |
| Event-driven communication | Directory must not call Care records to announce a new child — it publishes, and stops caring who listens |
| Local replica / data duplication | Directory is down at 08:00 drop-off and check-ins must still work |
| Durable queue + catch-up consumer | Care records was off all night; three enrollments happened |
| Idempotent consumer | The broker redelivers a message it already handled |
| Idempotency key | Dana taps check-in twice on a stalled network |
| Eventual consistency, explicit | Enrolled 08:14:58, checked in 08:15:00 — the replica is behind |
| Optimistic concurrency / DB-side constraint | Five enrollments race for the 20th place; the room must never hold 21 |
| Transactional outbox | A write commits but its event is lost on crash |
| Event ordering by occurrence time | "Withdrawn" arrives before "enrolled" |

### v0.2 — Gateway + Redis

| Pattern | Problem it solves |
| :--- | :--- |
| API gateway | Six services, one browser — auth, rate limits and routing must live in one place, not six |
| Service registry / discovery | Services move ports and restart; nobody may hardcode where a neighbour lives |
| Stateless token verification | Every service must authorize without calling Directory |
| Permission change by event | Sara's access was revoked a minute ago; who still trusts the old answer? |
| Cache stampede lock | Cache expires; fifty tablets hit the database in the same instant |
| Cache-aside + explicit invalidation | The classroom list is stale right after an enrollment |
| Fail-open degradation | Redis is switched off mid-day; nothing may return an error |
| Token-bucket rate limiting | One client hammering the gateway for everyone else |

### v0.3 — Notifications + jobs

| Pattern | Problem it solves |
| :--- | :--- |
| Retry with backoff + circuit breaker | The email provider is slow, then broken |
| Dead-letter queue | One poison message blocks the whole queue |
| Durable job queue | Redis restarts with jobs waiting — none may vanish |
| Visibility timeout / job reclaim | A worker dies holding a job |
| Bulkhead | Slow email work eats every worker and check-ins starve — separate pools so one flood drowns one compartment |

### v0.4 — Enrollment

| Pattern | Problem it solves |
| :--- | :--- |
| Saga with compensation | Enrollment crashes halfway; no orphaned half-made account |
| Process manager / state machine | A long-running signup must remember where it got to |
| Timeout + abandon | Consent forms that are never signed |
| Replica rebuild from source | Two weeks of wrong data in a copy |

### v0.5 — Reports + Kafka

| Pattern | Problem it solves |
| :--- | :--- |
| Event log replay | The whole Reports database is deleted |
| CQRS read model | Reporting queries would wreck the write side |
| Event sourcing | "Was Maya marked present at 09:00, or corrected later?" — only the event log can answer, current state cannot |
| Corrections, not deletes | Yesterday's recorded time was wrong |

### v0.6 — Media

| Pattern | Problem it solves |
| :--- | :--- |
| Presigned upload | A 400 MB video must never pass through a service |
| Claim check | Big payloads don't belong in messages |

### v0.7 — Splitting Directory

| Pattern | Problem it solves |
| :--- | :--- |
| Strangler fig | Directory has grown too big — carve out Billing behind the gateway, route by route, with nothing ever going down and no big-bang cutover |

### Unscheduled

| Pattern | Problem it solves |
| :--- | :--- |
| Offline-first sync | The tablet has no signal at drop-off |

Needs a phase once a client app exists. Its *server* half — client-generated
ids, and records carrying the time they happened — is decided in v0.1 and is
expensive to retrofit.
