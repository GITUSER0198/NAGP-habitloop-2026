"""Isolate environment settings between shared-library tests."""

import secrets
from collections.abc import Iterator

import pytest

from habitloop_shared.config import get_settings


@pytest.fixture(autouse=True)
def configured_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DB_SCHEMA", "users")
    monkeypatch.setenv("EVENT_BUS_MODE", "local")
    monkeypatch.setenv("EVENT_WORKER_URL", "http://event-worker:8000/events")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
