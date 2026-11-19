"""Environment configuration shared by local and ECS deployments."""

import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    jwt_secret: SecretStr = Field(validation_alias="JWT_SECRET")
    internal_token: SecretStr = Field(validation_alias="INTERNAL_TOKEN")
    database_url: SecretStr = Field(validation_alias="DATABASE_URL")
    db_schema: str = "public"
    event_bus_mode: Literal["local", "aws"] = "local"
    event_bus_name: str = "default"
    event_worker_url: str = "http://event-worker:8000/events"
    dynamodb_table: str = "habitloop-analytics"
    dynamodb_endpoint: str | None = None
    aws_region: str = "ap-south-1"
    user_service_url: str = "http://user-service:8000"
    activity_service_url: str = "http://activity-service:8000"
    challenge_service_url: str = "http://challenge-service:8000"
    integration_service_url: str = "http://integration-service:8000"
    analytics_service_url: str = "http://analytics-service:8000"
    recommendation_service_url: str = "http://recommendation-service:8000"
    log_level: str = "INFO"
    web_port: int | None = Field(default=None, ge=1, le=65535)

    @field_validator("jwt_secret", "internal_token", "database_url")
    @classmethod
    def nonempty_secret(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("must not be empty")
        return value

    @field_validator("db_schema")
    @classmethod
    def valid_schema(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", value):
            raise ValueError("DB_SCHEMA must be a lowercase SQL identifier")
        return value

    @field_validator("log_level")
    @classmethod
    def valid_log_level(cls, value: str) -> str:
        value = value.upper()
        if value not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("LOG_LEVEL must be a standard logging level")
        return value


@lru_cache
def get_settings() -> Settings:
    # Validate secrets before any app can start accepting requests.
    return Settings()
