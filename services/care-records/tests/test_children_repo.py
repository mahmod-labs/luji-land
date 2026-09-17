"""Runnable checks for the replica upsert: idempotency (rule 4) and occurrence
ordering. Needs care-db; run inside the container:

    docker compose exec care-records python -m pytest tests/test_children_repo.py

The tester layers full Testcontainers + Kafka acceptance on top; this is the
smallest thing that fails if the upsert logic breaks.
"""

import datetime

import pytest
from sqlalchemy import text

from app.db.repositories.children import apply_child_event
from app.db.session import Session

UTC = datetime.UTC


@pytest.mark.asyncio
async def test_redelivered_event_id_is_noop() -> None:
    eid, cid = "test-dup", "test-dup-child"
    now = datetime.datetime.now(UTC)
    async with Session() as s:
        first = await apply_child_event(
            s,
            event_id=eid,
            occurred_at=now,
            child_id=cid,
            fields={"first_name": "Grace"},
        )
    async with Session() as s:
        again = await apply_child_event(
            s,
            event_id=eid,
            occurred_at=now,
            child_id=cid,
            fields={"first_name": "Grace"},
        )
    async with Session() as s:
        rows = (
            await s.execute(
                text("select count(*) from children_replica where child_id=:c"),
                {"c": cid},
            )
        ).scalar()
    assert first is True
    assert again is False  # redelivery: no-op
    assert rows == 1


@pytest.mark.asyncio
async def test_older_event_does_not_clobber_newer_state() -> None:
    cid = "test-ord-child"
    t1 = datetime.datetime(2026, 1, 1, tzinfo=UTC)
    t2 = datetime.datetime(2026, 1, 2, tzinfo=UTC)
    async with Session() as s:  # newer classroom first
        await apply_child_event(
            s,
            event_id="ord-new",
            occurred_at=t2,
            child_id=cid,
            fields={"classroom_id": "NEW"},
        )
    async with Session() as s:  # older event arrives late
        await apply_child_event(
            s,
            event_id="ord-old",
            occurred_at=t1,
            child_id=cid,
            fields={"classroom_id": "OLD", "first_name": "Ada"},
        )
    async with Session() as s:
        classroom, first_name = (
            await s.execute(
                text(
                    "select classroom_id, first_name from children_replica where child_id=:c"
                ),
                {"c": cid},
            )
        ).one()
    assert classroom == "NEW"  # later occurrence wins
    assert first_name == "Ada"  # older event still fills a blank
