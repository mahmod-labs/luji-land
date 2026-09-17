"""children replica + processed-event idempotency ledger

Revision ID: 0001
Revises:
Create Date: 2026-09-17
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "children_replica",
        sa.Column("child_id", sa.String(), primary_key=True),
        sa.Column("first_name", sa.String(), nullable=True),
        sa.Column("last_name", sa.String(), nullable=True),
        sa.Column("classroom_id", sa.String(), nullable=True),
        sa.Column("enrollment_id", sa.String(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )
    # The idempotency column lives in the same migration as the table it guards
    # (SKILL rule 4): a redelivered eventId is rejected by this primary key.
    op.create_table(
        "processed_events",
        sa.Column("event_id", sa.String(), primary_key=True),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("processed_events")
    op.drop_table("children_replica")
