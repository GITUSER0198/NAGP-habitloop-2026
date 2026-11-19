"""Activity and occurrence tables in the configured activities schema."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from habitloop_shared.db import Base


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(100))
    frequency: Mapped[str] = mapped_column(String(10))
    days_of_week: Mapped[list[int]] = mapped_column(JSON().with_variant(ARRAY(Integer), "postgresql"))
    preferred_time: Mapped[str] = mapped_column(String(5))
    target_per_week: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    activity_id: Mapped[UUID] = mapped_column(ForeignKey("activities.id"), index=True)
    status: Mapped[str] = mapped_column(String(10))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source: Mapped[str] = mapped_column(String(10))
    source_event_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON().with_variant(JSONB, "postgresql"))
