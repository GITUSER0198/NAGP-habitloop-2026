"""Isolated integration database, JWTs, event bus and activity lookups."""

import secrets
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from habitloop_shared import events
from habitloop_shared.auth import encode_token
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def configured_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DB_SCHEMA", "integrations")
    get_settings.cache_clear()
    get_engine().dispose()
    yield
    get_engine().dispose()
    get_settings.cache_clear()


@pytest.fixture
def emitted(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    captured: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(events, "publish", lambda kind, detail: captured.append((kind, detail)))
    return captured


@pytest.fixture
def downstream(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {"status": 200, "requests": []}
    real_client = httpx.Client

    def handle(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        return httpx.Response(state["status"], json={"id": request.url.path.rsplit("/", 1)[-1]})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    return state


@pytest.fixture
def client(emitted: list[Any], downstream: dict[str, Any]) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def identity() -> dict[str, str]:
    return {"tenant_id": str(uuid4()), "user_id": str(uuid4())}


@pytest.fixture
def headers(identity: dict[str, str]) -> dict[str, str]:
    token = encode_token(identity["user_id"], identity["tenant_id"], "tester@example.com", "Tester")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def internal_headers(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, "X-Internal-Token": get_settings().internal_token.get_secret_value()}
