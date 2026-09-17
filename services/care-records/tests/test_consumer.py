"""End-to-end against the real consumer, real Kafka topics, real Postgres.

Covers slice 5's Verify and the redelivery / ordering / convergence
scenarios it exists for. `tests/test_children_repo.py` already exercises the
upsert function directly; these tests go one layer up and drive it through
`app.messaging.consumers.child_events.run_consumer`, so a bug in wiring
(topic names, JSON field mapping, commit timing) would show up here even if
the repo-level unit test stayed green.
"""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from aiokafka import AIOKafkaProducer
from sqlalchemy import text

from app.config import load_config
from app.db.session import Session
from app.messaging.consumers.child_events import run_consumer


async def _produce(topic: str, event: dict) -> None:
    producer = AIOKafkaProducer(bootstrap_servers=load_config().broker_list)
    await producer.start()
    try:
        await producer.send_and_wait(topic, json.dumps(event).encode())
    finally:
        await producer.stop()


class _ConsumerHandle:
    def __init__(self):
        self.stop = asyncio.Event()
        self.task = asyncio.create_task(run_consumer(self.stop))

    async def shutdown(self):
        self.stop.set()
        await self.task


async def _run_consumer_for(seconds: float) -> None:
    """Start the real consumer, let it drain what's on the topics, stop it."""
    handle = _ConsumerHandle()
    await asyncio.sleep(seconds)
    await handle.shutdown()


async def _replica_row(child_id: str):
    async with Session() as s:
        return (
            await s.execute(
                text(
                    "select first_name, last_name, classroom_id, enrollment_id, "
                    "occurred_at from children_replica where child_id=:c"
                ),
                {"c": child_id},
            )
        ).first()


async def _processed_count(event_id: str) -> int:
    async with Session() as s:
        return (
            await s.execute(
                text("select count(*) from processed_events where event_id=:e"),
                {"e": event_id},
            )
        ).scalar()


def _created_event(child_id: str, occurred_at: datetime, **overrides) -> dict:
    event = {
        "eventId": str(uuid.uuid4()),
        "occurredAt": occurred_at.isoformat(),
        "childId": child_id,
        "firstName": "Ada",
        "lastName": "Lovelace",
    }
    event.update(overrides)
    return event


def _enrolled_event(child_id: str, occurred_at: datetime, **overrides) -> dict:
    event = {
        "eventId": str(uuid.uuid4()),
        "occurredAt": occurred_at.isoformat(),
        "childId": child_id,
        "enrollmentId": str(uuid.uuid4()),
        "classroomId": "room-1",
    }
    event.update(overrides)
    return event


@pytest.mark.asyncio
async def test_catch_up_consumer_drains_backlog_produced_while_down():
    """Verify line: stop care-records, enrol a child, start it again ->
    the replica shows the child within seconds, with no Directory call
    (there is no Directory client in this service at all)."""
    child_id = f"catchup-{uuid.uuid4()}"
    now = datetime.now(UTC)

    # Consumer is NOT running yet. This is Directory publishing while
    # care-records is off.
    await _produce("directory.child.created", _created_event(child_id, now))
    await _produce(
        "directory.child.enrolled",
        _enrolled_event(child_id, now + timedelta(seconds=1)),
    )

    assert await _replica_row(child_id) is None  # confirm it really was down

    # Now start it back up — catch-up.
    handle = _ConsumerHandle()
    try:
        row = None
        for _ in range(60):
            row = await _replica_row(child_id)
            if row is not None:
                break
            await asyncio.sleep(0.5)
    finally:
        await handle.shutdown()

    assert row is not None
    assert row.first_name == "Ada"
    assert row.classroom_id == "room-1"


@pytest.mark.asyncio
async def test_redelivered_event_is_a_noop_through_the_real_consumer():
    """Rule 4: a tablet retries, or the broker redelivers, the same eventId.
    Produce the identical event twice on the real topic; the second delivery
    must not add a row or a ledger entry. This is the case that would have
    caught the rowcount-vs-RETURNING bug: a plain `result.rowcount` on an
    ON CONFLICT DO NOTHING is driver-dependent and can read as 1 even on a
    conflict, silently reapplying a stale event."""
    child_id = f"redelivery-{uuid.uuid4()}"
    now = datetime.now(UTC)
    event = _created_event(child_id, now)
    # Same eventId as `event`, but a different occurredAt/firstName. A real
    # broker redelivery repeats the identical bytes, but the service must
    # reject *any* message carrying an already-processed eventId, no matter
    # its payload — checking that here, rather than resending identical
    # bytes, is what actually catches a reapply: identical payloads would
    # leave the replica looking correct even if the ledger guard silently
    # let the second apply through (which is exactly the rowcount-vs-
    # RETURNING bug the builder found).
    redelivered_with_different_payload = dict(
        event, occurredAt=(now + timedelta(hours=1)).isoformat(), firstName="Imposter"
    )

    await _produce("directory.child.created", event)
    await _produce("directory.child.created", redelivered_with_different_payload)

    await _run_consumer_for(6)

    row = await _replica_row(child_id)
    assert row is not None
    assert row.first_name == "Ada"  # the second delivery's payload never applied
    assert await _processed_count(event["eventId"]) == 1

    async with Session() as s:
        count = (
            await s.execute(
                text("select count(*) from children_replica where child_id=:c"),
                {"c": child_id},
            )
        ).scalar()
    assert count == 1


@pytest.mark.asyncio
async def test_older_occurrence_does_not_clobber_newer_state_via_real_topic():
    """Occurrence ordering, driven end-to-end: enrol into room-1 at t2, then
    a straggler enrol-into-room-0 event at t1 arrives late (broker/network
    reorder). room-1 must survive; a field the newer event left blank
    (firstName, which `enrolled` never carries) is still filled by the
    older event."""
    child_id = f"order-{uuid.uuid4()}"
    t1 = datetime(2026, 1, 1, tzinfo=UTC)
    t2 = datetime(2026, 1, 2, tzinfo=UTC)

    newer = _enrolled_event(child_id, t2, classroomId="room-NEW")
    older = _created_event(child_id, t1, firstName="Grace")

    # Newer arrives first, older arrives late — the reorder this pattern exists for.
    await _produce("directory.child.enrolled", newer)
    await _produce("directory.child.created", older)

    await _run_consumer_for(6)

    row = await _replica_row(child_id)
    assert row is not None
    assert row.classroom_id == "room-NEW"  # later occurrence wins, not clobbered
    assert row.first_name == "Grace"  # older event still fills a blank field


@pytest.mark.asyncio
async def test_created_then_enrolled_converge_into_one_row():
    """Two distinct eventIds for the same child (created, then enrolled)
    merge into a single replica row carrying both sets of fields."""
    child_id = f"converge-{uuid.uuid4()}"
    now = datetime.now(UTC)

    await _produce(
        "directory.child.created",
        _created_event(child_id, now, firstName="Alan", lastName="Turing"),
    )
    await _produce(
        "directory.child.enrolled",
        _enrolled_event(child_id, now + timedelta(seconds=1), classroomId="room-9"),
    )

    await _run_consumer_for(6)

    row = await _replica_row(child_id)
    assert row is not None
    assert row.first_name == "Alan"
    assert row.last_name == "Turing"
    assert row.classroom_id == "room-9"

    async with Session() as s:
        count = (
            await s.execute(
                text("select count(*) from children_replica where child_id=:c"),
                {"c": child_id},
            )
        ).scalar()
    assert count == 1
