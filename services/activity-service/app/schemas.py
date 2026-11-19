"""Validated schedules, occurrence requests and API responses."""

from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import (
    AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints,
    field_validator, model_validator,
)

from app.categories import load_categories

Status = Literal["done", "completed", "missed"]
Frequency = Literal["daily", "weekly", "custom"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
PreferredTime = Annotated[str, StringConstraints(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
Day = Annotated[int, Field(strict=True, ge=0, le=6)]
Target = Annotated[int, Field(strict=True, ge=1, le=7)]
Duration = Annotated[int, Field(strict=True, ge=0)]


def valid_category(value: str) -> str:
    if value not in load_categories():
        raise ValueError("Choose a configured category")
    return value


Category = Annotated[str, AfterValidator(valid_category)]


class ActivityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    category: Category
    frequency: Frequency = "daily"
    days_of_week: list[Day] = Field(default_factory=list)
    preferred_time: PreferredTime = "09:00"
    target_per_week: Target = 7

    @field_validator("days_of_week")
    @classmethod
    def unique_days(cls, value: list[int]) -> list[int]:
        return sorted(set(value))

    @model_validator(mode="after")
    def valid_schedule(self) -> Self:
        if self.frequency in {"weekly", "custom"} and not self.days_of_week:
            raise ValueError("Weekly and custom schedules require days_of_week")
        return self


class ActivityPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    category: Category | None = None
    frequency: Frequency | None = None
    days_of_week: list[Day] | None = None
    preferred_time: PreferredTime | None = None
    target_per_week: Target | None = None

    @field_validator("name", "category", "frequency", "days_of_week", "preferred_time", "target_per_week")
    @classmethod
    def not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("Schedule fields cannot be null")
        return value


class SchedulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preferred_time: PreferredTime | None = None
    days_of_week: list[Day] | None = None
    target_per_week: Target | None = None

    @field_validator("preferred_time", "days_of_week", "target_per_week")
    @classmethod
    def not_null(cls, value: Any) -> Any:
        return ActivityPatch.not_null(value)


class ActivityResponse(ActivityCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    user_id: UUID
    active: bool


class TodayItem(ActivityResponse):
    status: Status | None
    due_at: datetime


class LogCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Status
    logged_at: AwareDatetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    duration_min: Duration | None = None


class PartnerLogCreate(LogCreate):
    tenant_id: UUID
    user_id: UUID
    activity_id: UUID
    logged_at: AwareDatetime
    source: Literal["partner"]
    source_event_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    metadata: dict[str, Any] = Field(default_factory=dict)


class LogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    tenant_id: UUID
    user_id: UUID
    activity_id: UUID
    status: Status
    logged_at: datetime
    source: Literal["manual", "partner"]
    source_event_id: str | None
    duration_min: int | None
    metadata: dict[str, Any] = Field(validation_alias="metadata_")

    @field_validator("logged_at")
    @classmethod
    def utc_if_naive(cls, value: datetime) -> datetime:
        # SQLite drops timezone information; stored timestamps are normalized to UTC.
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
