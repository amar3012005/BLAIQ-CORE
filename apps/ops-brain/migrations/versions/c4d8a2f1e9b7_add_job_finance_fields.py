"""Add cost_items + payment_due_date to ops.jobs.

Phase 1 of the BLAIQ admin workflow: itemised third-party costs (so the PM
can collect Fremdkosten line by line and apply the +15% production fee) and
an invoice payment due date (so jobs can auto-flag as overdue).

Revision ID: c4d8a2f1e9b7
Revises: b3c9f12e4a88
Create Date: 2026-06-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c4d8a2f1e9b7"
down_revision = "b3c9f12e4a88"
branch_labels = None
depends_on = None

_SCHEMA = "ops"


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    return bool(
        conn.execute(
            sa.text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = :s AND table_name = :t AND column_name = :c"
            ),
            {"s": _SCHEMA, "t": table, "c": column},
        ).scalar()
    )


def upgrade() -> None:
    if not _column_exists("jobs", "cost_items"):
        op.add_column(
            "jobs",
            sa.Column(
                "cost_items",
                postgresql.JSONB,
                nullable=False,
                server_default="[]",
            ),
            schema=_SCHEMA,
        )
    if not _column_exists("jobs", "payment_due_date"):
        op.add_column(
            "jobs",
            sa.Column("payment_due_date", sa.Date, nullable=True),
            schema=_SCHEMA,
        )


def downgrade() -> None:
    if _column_exists("jobs", "payment_due_date"):
        op.drop_column("jobs", "payment_due_date", schema=_SCHEMA)
    if _column_exists("jobs", "cost_items"):
        op.drop_column("jobs", "cost_items", schema=_SCHEMA)
