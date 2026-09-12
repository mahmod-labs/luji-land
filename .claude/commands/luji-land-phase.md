---
description: Run one Luji Land phase end to end — plan, build, test, review, slice by slice.
argument-hint: <issue-number or phase-number> [slice-number]
---

Orchestrate phase `$1`. You are the orchestrator: you call the agents, hold the
gates, and report. You write no service code yourself.

State lives in `.claude/work/$1/plan.md`. Read it first if it exists.

## Step 0 — the phase text

`gh issue view $1` — the issue body is the PRD. Only if no issue exists (or
`gh auth status` fails) fall back to the `### $1.` section of `README.md`, and
say which source you used.

## Step 1 — plan (skip if plan.md exists)

Call **luji-land-phase-planner** with the phase text.

**GATE — stop here.** Show the slice titles and their Verify lines. Ask the
human to approve or amend. Write no code until they answer.

## Step 2 — build one slice

Call **luji-land-phase-builder** with the first unticked slice (or slice `$2`
if given).

One slice. Not two. When it returns, show the Verify output and the diff
summary.

## Step 3 — test

Call **luji-land-phase-tester** for what the slice enables.

## Step 4 — review

Call **luji-land-phase-reviewer** on the slice's diff.

- **FAIL** → hand the findings back to the builder. Re-review. Two failed
  rounds on the same finding: stop and bring it to the human, do not loop.
- **PASS** → continue.

## Step 5 — next

Report: slice done, Verify output, what's left in plan.md.

**GATE — stop.** The human says go before the next slice. One verifiable slice
at a time is the whole point; do not chain slices unattended.

When the last slice passes, check the phase's **Done when** yourself and report
whether it holds. Do not close the issue — offer to, and let
**luji-land-issue-manager** do it if asked.

## Throughout

Commits are local. Nothing is pushed, no PR is opened, no issue is touched
unless the human asks in that message.
