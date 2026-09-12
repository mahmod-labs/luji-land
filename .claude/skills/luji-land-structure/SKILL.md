---
name: luji-land-structure
description: Folder layout, file naming, TypeScript and Python conventions, and database/migration organisation for Luji Land services. Read before creating a new service, adding a folder, deciding where a file goes, naming a module, adding an index/barrel file, or writing a migration.
---

# Luji Land — structure and conventions

The architecture rules live in `README.md` § Architecture. This is where files
go and what they're called. When the two disagree, the README wins.

## The one thing that shapes everything

**No service imports from another.** That kills the usual monorepo instinct:
there is no root `types/`, no root `utils/`, no root `lib/`, no shared package.
Two services needing the same helper each get their own copy. **Duplication
across services is correct here** — it is what lets them deploy, fail, and be
rewritten independently.

The only root folders that cross service lines are `contracts/` (JSON Schema,
generated from, never imported) and `compose.yml` / `Makefile` (operations).

## Repo root

```
luji-land/
├── services/           one folder per service, no nesting
├── contracts/          JSON Schema — the only shared shapes
├── compose.yml         every service, every backing store
├── Makefile            up, down, test, migrate, logs
├── README.md
├── CLAUDE.md
└── .claude/            agents, commands, skills, work/
```

Nothing else at root. A new root folder needs a reason that isn't "it felt
tidy".

### `contracts/`

```
contracts/
├── directory/
│   ├── child.created.v1.json
│   └── child.withdrawn.v1.json
└── care-records/
    └── check-in.recorded.v1.json
```

One file per event, named `<topic>.v<n>.json`. **Versioned from the first
one** — renaming a v1 after a consumer exists is the migration you don't want.
A breaking change is a new version file, never an edit; both versions ship
until every consumer has moved.

Each service generates its own types at build time — `json-schema-to-typescript`
for TS, `datamodel-code-generator` for Python — into `src/contracts/generated/`,
which is **gitignored**. Generated types are never hand-edited.

## A TypeScript service

```
services/directory/
├── src/
│   ├── main.ts                  bootstrap only
│   ├── config.ts                parsed + validated at startup, exported typed
│   ├── modules/
│   │   └── children/
│   │       ├── children.module.ts
│   │       ├── children.controller.ts
│   │       ├── children.service.ts
│   │       ├── children.repository.ts
│   │       ├── dto/
│   │       │   ├── create-child.dto.ts
│   │       │   └── child.response.dto.ts
│   │       └── children.spec.ts
│   ├── messaging/
│   │   ├── producer.ts
│   │   ├── outbox.ts            the publisher loop
│   │   └── consumers/
│   │       └── child-enrolled.consumer.ts
│   ├── types/                   types used across modules in THIS service
│   ├── utils/                   pure functions, no I/O, no framework imports
│   ├── helpers/                 framework-aware — guards, pipes, interceptors
│   └── contracts/generated/     gitignored
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/                       Testcontainers, cross-module
├── Dockerfile
├── package.json
└── tsconfig.json
```

**`utils` vs `helpers`:** a util is pure and testable with no setup —
`slugify`, `hoursBetween`. A helper knows about Nest, HTTP, or Prisma — a
guard, a pipe, a repository mixin. If it imports a framework, it is a helper.
If neither fits, it belongs in the module that uses it — most things do.

**`types/` is for what several modules share.** A type used by one module lives
in that module. Do not promote a type on the *chance* another module wants it.

## A Python service

```
services/care-records/
├── app/
│   ├── main.py
│   ├── config.py                pydantic-settings, validated at import
│   ├── api/
│   │   └── check_ins.py         routers
│   ├── domain/                  business logic, no FastAPI imports
│   ├── db/
│   │   ├── models.py            SQLAlchemy
│   │   ├── session.py
│   │   └── repositories/
│   ├── messaging/
│   │   ├── producer.py
│   │   └── consumers/
│   ├── jobs/                    arq tasks
│   ├── utils/
│   └── contracts/generated/     gitignored
├── alembic/
│   ├── env.py
│   └── versions/
├── tests/
├── Dockerfile
└── pyproject.toml
```

Mirror the TS layout in spirit, not in letter. `modules/` ↔ `api/` + `domain/`.
Do not force NestJS shapes onto FastAPI.

## Naming

| Thing | Convention | Example |
| :--- | :--- | :--- |
| TS file | `kebab-case.role.ts` | `children.service.ts` |
| TS class | `PascalCase` matching the file | `ChildrenService` |
| TS type / interface | `PascalCase`, no `I` prefix | `Child`, not `IChild` |
| TS enum-like | `as const` object, not `enum` | `const Status = {...} as const` |
| Python file | `snake_case.py` | `check_ins.py` |
| Python class | `PascalCase` | `CheckInRepository` |
| Folder | plural for collections | `modules/`, `consumers/` |
| Kafka topic | `<service>.<entity>.<event>` | `directory.child.enrolled` |
| DLQ topic | the topic plus `.dlq` | `directory.child.enrolled.dlq` |
| Env var | `SCREAMING_SNAKE`, service-prefixed | `DIRECTORY_DATABASE_URL` |

## Index / barrel files

**Default: no.** A barrel that re-exports a folder creates import cycles,
defeats tree-shaking, and hides where a symbol actually lives. Import from the
real path.

The one exception: a module's **public edge**, where an `index.ts` exporting
two or three symbols is genuinely the module's API and everything else is
private. Never a barrel that re-exports everything in a folder. Never
`utils/index.ts`.

Python: `__init__.py` stays empty except where a package's public surface is
deliberately small.

## TypeScript conventions

- `strict: true`. Every service. No exceptions, no `strictNullChecks: false`.
- **No `any`.** `unknown` at boundaries, then narrow. A justified `any` gets a
  comment saying why.
- No non-null `!`. If you know it's there, prove it to the compiler.
- `type` for shapes and unions, `interface` only when declaration merging is
  actually needed — which is almost never.
- Validate every inbound payload — HTTP body and Kafka message — with `zod` or
  Nest's `ValidationPipe`. A generated type is a compile-time claim, not a
  runtime check. **Trust nothing crossing a process boundary.**
- No default exports. Named exports only — they rename safely and grep.
- `async`/`await` throughout; no raw `.then()` chains.
- Errors are typed and thrown, not returned as `null`. A caller must not be
  able to ignore a failure by accident.

## Python conventions

- Type hints on every function signature. `mypy` clean.
- `pydantic` models at every boundary — request, response, consumed event.
- `async def` for anything touching I/O.
- `ruff` for lint and format. No arguing about style.

## Database and migrations

**One database per service. One migration history per service.** There is no
repo-wide migration folder and never will be.

- **TS:** Prisma. `prisma/schema.prisma`, migrations in `prisma/migrations/`.
- **Python:** Alembic. `alembic/versions/`.

Rules for both:

1. **Migrations are forward-only.** A mistake in a shipped migration is fixed
   by a new migration, never by editing the old one.
2. **One migration, one concern**, named for what it does —
   `add_room_capacity_constraint`, not `update_schema`.
3. **Constraints belong in the database**, not in service code. Room capacity,
   uniqueness, foreign keys, check constraints. The README is explicit about
   this and it is what makes the concurrency tests pass.
4. **Every table that a message handler writes needs its idempotency column**
   — a processed-event id, or a unique key on the natural identity. Added in
   the same migration as the table, not bolted on later.
5. A replica table is named for what it is — `children_replica`, not
   `children`. Nobody should have to check whether a table is source of truth.
6. `make migrate` runs every service's migrations. A service that can't be
   migrated independently is a broken service.

## Tests

Beside the code for unit-ish tests (`children.spec.ts`, `test_check_ins.py`).
In the service's `tests/` for anything needing a container.

Testcontainers against real Postgres and real Kafka — never a mock, never an
in-memory broker. The README says why: a fake hides exactly the bugs this
project exists to learn about.

## When adding anything

Ask, in order:

1. Does this belong to one service? → it goes inside that service. Almost
   everything stops here.
2. Is it a message shape? → `contracts/`, versioned, generated from.
3. Is it operations? → `compose.yml` or the `Makefile`.
4. Anything else that wants to be shared between services → **it doesn't.**
   Copy it, or pass it over HTTP or Kafka.
