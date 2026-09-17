"""SQLAlchemy models for care-db.

The children table is a REPLICA, not source of truth — named `children_replica`
per the SKILL. Care records never calls Directory (rules 1 + 3); it learns who a
child is only from `directory.child.*` Kafka events. `processed_events` is the
idempotency ledger (rule 4): a redelivered eventId is a no-op.
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ChildReplica(Base):
    __tablename__ = "children_replica"

    child_id: Mapped[str] = mapped_column(String, primary_key=True)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_name: Mapped[str | None] = mapped_column(String, nullable=True)
    classroom_id: Mapped[str | None] = mapped_column(String, nullable=True)
    enrollment_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # The authoritative occurrence time of the newest event applied to this row.
    # Ordering hangs off this, not off broker arrival order.
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ProcessedEvent(Base):
    __tablename__ = "processed_events"

    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
