"""Recommendation history in the configured recommendations schema."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, Index, String, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from habitloop_shared.db import Base


class Recommendation(Base):
    __tablename__ = "recommendations"
    __table_args__ = (
        Index(
            "uq_pending_recommendation_values", "tenant_id", "user_id", "activity_id",
            "kind", "current_value", "suggested_value", unique=True,
            postgresql_where=text("status = 'pending'"), sqlite_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    activity_id: Mapped[UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(10))
    current_value: Mapped[dict[str, str | int]] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    suggested_value: Mapped[dict[str, str | int]] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    reason: Mapped[str] = mapped_column(String(1000))
    confidence: Mapped[str] = mapped_column(String(6))
    status: Mapped[str] = mapped_column(String(9), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
