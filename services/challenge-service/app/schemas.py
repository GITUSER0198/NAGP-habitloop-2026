"""Validated challenge requests and explicit API responses."""

from datetime import date, datetime, timezone
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Category = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
InviteCode = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z0-9]{8}$")]


class ChallengeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    description: str = Field(default="", max_length=10000)
    visibility: Literal["public", "private"] = "public"
    activity_category: Category
    start_date: date
    end_date: date
    target_count: int = Field(strict=True, ge=1)

    @model_validator(mode="after")
    def ordered_dates(self) -> Self:
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class ChallengeResponse(ChallengeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    owner_id: UUID


class ChallengeCreated(ChallengeResponse):
    invite_code: str


class InviteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_ids: list[UUID] = Field(default_factory=list)

    @field_validator("user_ids")
    @classmethod
    def unique_users(cls, values: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(values))


class InviteResponse(BaseModel):
    invite_code: str
    user_ids: list[UUID]


class CodeJoin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invite_code: InviteCode


class ParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    challenge_id: UUID
    user_id: UUID
    tenant_id: UUID
    status: Literal["invited", "joined", "declined", "left"]
    joined_at: datetime | None

    @field_validator("joined_at")
    @classmethod
    def utc_if_naive(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
