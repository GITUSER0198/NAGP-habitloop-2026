"""Validated API requests and public profile responses."""

import re
import unicodedata
from datetime import datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator, BaseModel, ConfigDict, EmailStr, Field, SecretStr, StringConstraints,
    field_validator,
)


def tenant_slug(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")


def valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Use a valid IANA timezone, such as Asia/Kolkata") from None
    return value


def valid_password(value: SecretStr) -> SecretStr:
    if not 1 <= len(value.get_secret_value().encode("utf-8")) <= 72:
        raise ValueError("Password must contain between 1 and 72 UTF-8 bytes")
    return value


def normalized_email(value: str) -> str:
    return value.lower()


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Timezone = Annotated[str, StringConstraints(max_length=100), AfterValidator(valid_timezone)]
Password = Annotated[SecretStr, AfterValidator(valid_password)]
Email = Annotated[EmailStr, AfterValidator(normalized_email), Field(max_length=254)]


class RegisterRequest(BaseModel):
    email: Email
    password: Password
    name: Name
    tenant_name: Name
    timezone: Timezone = "UTC"

    @field_validator("tenant_name")
    @classmethod
    def valid_tenant_name(cls, value: str) -> str:
        if not tenant_slug(value):
            raise ValueError("Tenant name must produce a nonempty slug")
        return value


class LoginRequest(BaseModel):
    tenant_slug: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    email: Email
    password: SecretStr


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    timezone: Timezone | None = None

    @field_validator("name", "timezone")
    @classmethod
    def supplied_fields_not_null(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("Profile fields cannot be null")
        return value


class Profile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    email: str
    name: str
    timezone: str
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: Profile


class TenantLookup(BaseModel):
    exists: bool
    name: str | None
