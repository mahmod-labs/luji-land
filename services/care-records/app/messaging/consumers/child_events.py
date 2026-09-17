"""Kafka consumer feeding the children replica.

Reads `directory.child.*`. Rule 3: this is the only way Care records learns
about children — there is no Directory HTTP client anywhere in this service. A
fixed group id + commit-after-process gives catch-up (a child enrolled while we
were down is read on the next start) and, with the idempotent upsert,
at-least-once redelivery is safe.
"""

import asyncio
import json
import logging
from datetime import datetime

from aiokafka import AIOKafkaConsumer

from app.config import load_config
from app.db.repositories.children import apply_child_event
from app.db.session import Session

logger = logging.getLogger(__name__)

TOPICS = ("directory.child.created", "directory.child.enrolled")

# Which event fields land in which replica columns. Events carry disjoint
# fields (created has names, enrolled has classroom); the upsert merges them.
_FIELD_KEYS = ("firstName", "lastName", "classroomId", "enrollmentId")
_TO_COLUMN = {
    "firstName": "first_name",
    "lastName": "last_name",
    "classroomId": "classroom_id",
    "enrollmentId": "enrollment_id",
}


async def _handle(raw: bytes) -> None:
    event = json.loads(raw)
    fields = {_TO_COLUMN[k]: event[k] for k in _FIELD_KEYS if event.get(k) is not None}
    async with Session() as session:
        applied = await apply_child_event(
            session,
            event_id=event["eventId"],
            occurred_at=datetime.fromisoformat(event["occurredAt"]),
            child_id=event["childId"],
            fields=fields,
        )
    if not applied:
        logger.info("duplicate event %s ignored", event["eventId"])


async def run_consumer(stop: asyncio.Event) -> None:
    cfg = load_config()
    consumer = AIOKafkaConsumer(
        *TOPICS,
        bootstrap_servers=cfg.broker_list,
        group_id=cfg.kafka_group_id,
        auto_offset_reset="earliest",  # first boot replays history (catch-up)
        enable_auto_commit=False,  # commit only after the row is persisted
    )
    await consumer.start()
    logger.info("consuming %s", ", ".join(TOPICS))
    try:
        while not stop.is_set():
            batch = await consumer.getmany(timeout_ms=1000, max_records=100)
            for messages in batch.values():
                for message in messages:
                    await _handle(message.value)
            if batch:
                await consumer.commit()
    finally:
        await consumer.stop()
