# Phase 1 — Directory + Care records + Kafka

Issue: #1
Done when:
- [ ] `compose stop directory` → a check-in still returns 201
- [ ] Stop Care records, enrol a child, start it again → the replica catches up on its own

## Slices

Seam: slices 1–3 stand alone and are verifiable without any Kafka consumption.
Slices 4–6 add the outbox and everything downstream of it.

### 1. Compose: two Postgres + Kafka, one `make up`
- [x] `compose.yml`: `directory-db`, `care-db` (Postgres 17, separate volumes), one Kafka broker
- [x] Healthchecks on all three; `make up` / `make down` targets
- [x] `make up` waits until healthy before returning
**Touches:** compose.yml, Makefile
**Verify:** `make up` → `docker compose ps` shows directory-db, care-db, kafka all `healthy`

### 2. Directory service: classrooms, children, staff (own DB)
- [ ] NestJS on Fastify, port 3001, config validated at startup (rule 6)
- [ ] Prisma schema + migration: classrooms, children, staff in `directory-db`
- [ ] Client-generated ids (id supplied by caller) on create — decided here, expensive to retrofit
- [ ] CRUD endpoints for the three resources
**Touches:** services/directory, contracts/
**Verify:** `curl -X POST :3001/children -d '{"id":"<uuid>",...}'` → 201; `curl :3001/children/<uuid>` → 200 with the record

### 3. Room capacity as a DB constraint
- [ ] Enrollment writes child→classroom; capacity enforced in the database, not service code
- [ ] Constraint/trigger rejects the over-limit write atomically (DB-side, race-safe)
- [ ] Service maps the DB rejection to 409
**Touches:** services/directory
**Verify:** fire the 20th and 21st enrollment into a capacity-20 room concurrently → exactly one 201, the other 409; `SELECT count(*)` = 20

### 4. Transactional outbox + publisher loop
- [ ] `outbox` table in directory-db; enrollment/child writes append an event row in the same transaction
- [ ] Events carry an event id and an occurrence time (occurred-at decided here — offline sync needs it)
- [ ] Publisher loop drains outbox → `directory.child.*` topics, marks rows sent
**Touches:** services/directory, contracts/
**Verify:** enrol a child, then `kafka-console-consumer --topic directory.child.enrolled --from-beginning` → the event appears with its id and occurrence time

### 5. Care records: consume into a local replica (catch-up + idempotent)
- [ ] FastAPI, port 3002, Alembic migration for a local `children` replica table in care-db
- [ ] Consumer reads `directory.child.*`, upserts the replica, ordered by occurrence time (withdrawn-before-enrolled safe)
- [ ] Idempotent on event id — a redelivered event is a no-op
**Touches:** services/care-records, contracts/
**Verify:** stop care-records, enrol a child, start care-records → `SELECT` on care-db replica shows the child within seconds, with no Directory call

### 6. Check-in endpoint: replica-only read + idempotency key
- [ ] `POST /check-ins` reads the replica only, never calls Directory
- [ ] Write carries a client idempotency key; a repeat key returns the original result, no duplicate row
**Touches:** services/care-records
**Verify:** `compose stop directory`, then `POST /check-ins` → 201; repeat the same idempotency key → same result, one row in the DB

## Patterns

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
here — expensive to retrofit, and what offline sync will need.

## Open questions
- None. Issue specifies topic shape (`directory.child.*`), capacity seam (DB
  constraint), and replica-only check-in. Contract payload fields for each
  `directory.child.*` event are the builder's to pin down in `contracts/` at
  slice 4.
