"""Public integration responses never expose stored ingest key hashes."""

from datetime import datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator,
)

PROVIDERS: dict[str, list[str]] = {
    "mockfit": ["run", "walk", "cycle", "swim"],
    "mockrun": ["run", "walk"],
}
Provider = Literal["mockfit", "mockrun"]
Text = Annotated[str, StringConstraints(min_length=1, max_length=255)]


class LinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Provider
    activity_map: dict[str, UUID]

    @model_validator(mode="after")
    def known_activity_types(self) -> Self:
        if any(key not in PROVIDERS[self.provider] for key in self.activity_map):
            raise ValueError("Map only activity types supported by this provider")
        return self


class LinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    user_id: UUID
    provider: Provider
    status: str
    activity_map: dict[str, UUID]
    created_at: datetime


class LinkCreated(LinkResponse):
    ingest_key: str


class Workout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: Text
    type: Literal["workout"]
    started_at: AwareDatetime
    duration_min: Annotated[int, Field(strict=True, ge=0)]
    steps: Annotated[int, Field(strict=True, ge=0)] | None = None
    provider_activity: Text


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    link_id: UUID
    event_id: str
    payload: dict[str, Any]
    status: Literal["received", "normalized", "rejected"]
    reason: str | None
    received_at: datetime


class EventPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["received", "normalized", "rejected"]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)] | None = None
