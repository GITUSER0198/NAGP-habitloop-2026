"""Challenge and participant tables in the configured challenges schema."""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from habitloop_shared.db import Base


class Challenge(Base):
    __tablename__ = "challenges"
    __table_args__ = (
        UniqueConstraint("tenant_id", "invite_code"),
        UniqueConstraint("tenant_id", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(7))
    invite_code: Mapped[str] = mapped_column(String(8))
    activity_category: Mapped[str] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    target_count: Mapped[int] = mapped_column(Integer)


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "challenge_id"], ["challenges.tenant_id", "challenges.id"],
        ),
    )

    challenge_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    tenant_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String(8))
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
