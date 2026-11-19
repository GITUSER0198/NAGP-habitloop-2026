"""Recommendation responses and validated upstream history."""

from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

RecommendationStatus = Literal["pending", "accepted", "dismissed"]
Confidence = Literal["low", "medium", "high"]
ScheduleValue = dict[str, str | int]


class RecommendationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    user_id: UUID
    activity_id: UUID
    kind: Literal["timing", "frequency"]
    current_value: ScheduleValue
    suggested_value: ScheduleValue
    reason: str
    confidence: Confidence
    status: RecommendationStatus
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_if_naive(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class RecommendationList(BaseModel):
    recommendations: list[RecommendationResponse]
    reason: str | None = None


class ActivityHistory(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    name: str
    frequency: Literal["daily", "weekly", "custom"]
    preferred_time: Annotated[str, Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
    target_per_week: Annotated[int, Field(strict=True, ge=1, le=7)]
    active: bool


class LogHistory(BaseModel):
    tenant_id: UUID
    user_id: UUID
    activity_id: UUID
    status: Literal["done", "completed", "missed"]
    logged_at: AwareDatetime


class HourHistory(BaseModel):
    hour: Annotated[int, Field(ge=0, le=23)]
    attempts: Annotated[int, Field(ge=0)]
    successes: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def valid_counts(self) -> "HourHistory":
        if self.successes > self.attempts:
            raise ValueError("Successes cannot exceed attempts")
        return self
