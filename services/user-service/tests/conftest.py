"""Fresh in-memory database and environment for each service test."""

import secrets
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from habitloop_shared.config import get_settings
from habitloop_shared.db import get_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def configured_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DB_SCHEMA", "users")
    get_settings.cache_clear()
    get_engine().dispose()
    yield
    get_engine().dispose()
    get_settings.cache_clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
