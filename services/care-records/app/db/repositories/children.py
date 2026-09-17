"""Idempotent, occurrence-ordered upsert into the children replica."""

from datetime import datetime

from sqlalchemy import case, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ChildReplica, ProcessedEvent

_FIELDS = ("first_name", "last_name", "classroom_id", "enrollment_id")


async def apply_child_event(
    session: AsyncSession,
    *,
    event_id: str,
    occurred_at: datetime,
    child_id: str,
    fields: dict[str, str],
) -> bool:
    """Apply one directory.child.* event. Returns False if it was a duplicate.

    Rule 4 (idempotent): the eventId is inserted into the ledger first; a
    conflict means we have already handled it, so we do nothing and report a
    no-op. Ledger insert and replica upsert share one transaction — a child is
    recorded as processed only if its row change also commits.
    """
    ledger = await session.execute(
        insert(ProcessedEvent)
        .values(event_id=event_id)
        .on_conflict_do_nothing(index_elements=["event_id"])
        .returning(ProcessedEvent.event_id)
    )
    # DO NOTHING + RETURNING yields a row only on a real insert; on a conflict
    # (already in the ledger → redelivery) it returns nothing, so we no-op.
    if ledger.first() is None:
        return False

    row = {"child_id": child_id, "occurred_at": occurred_at}
    row.update({f: fields.get(f) for f in _FIELDS})
    stmt = insert(ChildReplica).values(**row)

    # Per-field occurrence ordering: when the incoming event occurred at or
    # after the row's newest event, its non-null fields win; an older event
    # only fills blanks it and never clobbers newer state (withdrawn-before-
    # enrolled safe). occurred_at tracks the newest applied.
    newer = stmt.excluded.occurred_at >= ChildReplica.occurred_at
    set_ = {
        f: case(
            (newer, func.coalesce(getattr(stmt.excluded, f), getattr(ChildReplica, f))),
            else_=func.coalesce(getattr(ChildReplica, f), getattr(stmt.excluded, f)),
        )
        for f in _FIELDS
    }
    set_["occurred_at"] = func.greatest(
        stmt.excluded.occurred_at, ChildReplica.occurred_at
    )
    await session.execute(
        stmt.on_conflict_do_update(index_elements=["child_id"], set_=set_)
    )
    await session.commit()
    return True
