# Luji Land

A daycare system, built as a practice project for microservices. One repo, one
service per business capability, never a shared database.

Nothing is built yet.

## Where things live

- **`README.md`** — the design, the stack, the 7 rules, the 7 phases. Read the
  relevant section before changing code in that area.
- **Milestones** — the 7 phases.
- **Issues** — the one thing being built now. Its body is that service's PRD.
- **`.claude/skills/luji-land-structure/`** — folder layout, file naming, TS/Py
  conventions, migrations. Read before creating any file or folder.
- **`.claude/work/<n>/plan.md`** — the live slice plan for the phase in flight.

**The issue body is the PRD, and it wins.** When a phase's issue exists, it is
the source of truth for that phase — the README section shrinks to a one-line
summary plus the issue link at the moment the issue is created. Two copies of a
phase is how they drift. The issue never overrides README § Architecture: the
7 rules and the stack stay canonical.

## The workflow

Each phase is run by `/luji-land-phase <n>`, which orchestrates four agents against the
issue body and `plan.md`:

- **luji-land-phase-planner** — issue → slices in `plan.md`, each with a Verify
  line. Stops for approval. Writes no code.
- **luji-land-phase-builder** — one slice: code, run Verify, commit locally.
- **luji-land-phase-tester** — Testcontainers against real Postgres + Kafka,
  proving the Done-when and the acceptance scenarios.
- **luji-land-phase-reviewer** — checks the 7 rules and Done-when. Fixes nothing.

Two gates, both deliberate: after the plan, and after every slice. One
verifiable slice at a time.

**luji-land-issue-manager** handles GitHub issues when explicitly invoked — it
confirms before every write.

## Never touch GitHub unless asked

**No push, no force-push, no branch or tag delete, no issue, milestone, label,
project, release, or settings change — unless I ask for that specific thing in
that message.** Committing locally is fine and needs no permission. Anything
that leaves this machine does. When a task seems to need it, stop and ask.

## Working agreement

- One open issue at a time. Two means the second hasn't started.
- One verifiable slice at a time. Confirm each before the next.
- A service is specified when it's built — one sentence in the README until then.
- A pattern in the README becomes an issue only when work starts on it. That
  table is not a backlog.
