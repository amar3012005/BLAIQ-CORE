"""Add ops.jobs table for BLAIQ tri-track job lifecycle.

Revision ID: b3c9f12e4a88
Revises: a2f8e91c3d47
Create Date: 2026-06-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b3c9f12e4a88"
down_revision = "a2f8e91c3d47"
branch_labels = None
depends_on = None

_SCHEMA = "ops"


def _table_exists(table: str) -> bool:
    conn = op.get_bind()
    return bool(
        conn.execute(
            sa.text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = :s AND table_name = :t"
            ),
            {"s": _SCHEMA, "t": table},
        ).scalar()
    )


def upgrade() -> None:
    """Create ops.jobs."""
    if _table_exists("jobs"):
        return

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=False), nullable=False, index=True),
        sa.Column("job_number", sa.String(64), nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("client", sa.Text, nullable=False, server_default=""),
        # POOOL track
        sa.Column("poool_status", sa.String(32), nullable=False, server_default="quote_pending"),
        sa.Column("poool_job_id", sa.Text, nullable=True),
        sa.Column("quote_amount", sa.Float, nullable=True),
        sa.Column("third_party_costs", sa.Float, nullable=True),
        sa.Column("invoice_amount", sa.Float, nullable=True),
        # ClickUp track
        sa.Column("clickup_folder_id", sa.Text, nullable=True),
        sa.Column("clickup_ticket_ids", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("revision_count", sa.Integer, nullable=False, server_default="0"),
        # Server track
        sa.Column("server_folder_path", sa.Text, nullable=True),
        sa.Column("delivery_status", sa.String(32), nullable=False, server_default="in_progress"),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        # Metadata
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        schema=_SCHEMA,
    )

    # RLS: only the owning tenant can see its rows
    op.execute(
        sa.text(
            f"ALTER TABLE {_SCHEMA}.jobs ENABLE ROW LEVEL SECURITY"
        )
    )
    op.execute(
        sa.text(
            f"CREATE POLICY jobs_tenant_isolation ON {_SCHEMA}.jobs "
            f"USING (tenant_id::text = current_setting('app.tenant_id', true))"
        )
    )


def downgrade() -> None:
    """Drop ops.jobs."""
    if not _table_exists("jobs"):
        return
    op.execute(sa.text(f"DROP POLICY IF EXISTS jobs_tenant_isolation ON {_SCHEMA}.jobs"))
    op.drop_table("jobs", schema=_SCHEMA)
