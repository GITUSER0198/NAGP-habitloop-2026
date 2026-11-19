"""Isolated database, tenant identities and recipient validation for challenge tests."""

import secrets
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from habitloop_shared.auth import encode_token
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def configured_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DB_SCHEMA", "challenges")
    get_settings.cache_clear()
    get_engine().dispose()
    yield
    get_engine().dispose()
    get_settings.cache_clear()


@pytest.fixture
def recipients(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {"missing": set(), "status": 200, "requests": [], "emails": {}}
    real_client = httpx.Client

    def handle(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        if request.url.path == "/api/users/internal/users":
            user_id = state["emails"].get(request.url.params["email"])
            return httpx.Response(404 if user_id is None else state["status"], json={"id": user_id})
        user_id = request.url.path.rsplit("/", 1)[-1]
        status = 404 if user_id in state["missing"] else state["status"]
        return httpx.Response(status, json={"id": user_id})

    def make_client(**kwargs: Any) -> httpx.Client:
        return real_client(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "Client", make_client)
    return state


@pytest.fixture
def client(recipients: dict[str, Any]) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def identity() -> dict[str, str]:
    return {"tenant_id": str(uuid4()), "user_id": str(uuid4())}


@pytest.fixture
def headers(identity: dict[str, str]) -> dict[str, str]:
    token = encode_token(identity["user_id"], identity["tenant_id"], "owner@example.com", "Owner")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def peer(identity: dict[str, str]) -> dict[str, str]:
    user_id = str(uuid4())
    token = encode_token(user_id, identity["tenant_id"], "peer@example.com", "Peer")
    return {"user_id": user_id, "Authorization": f"Bearer {token}"}


@pytest.fixture
def foreign() -> dict[str, str]:
    user_id, tenant_id = str(uuid4()), str(uuid4())
    token = encode_token(user_id, tenant_id, "other@example.com", "Other")
    return {"user_id": user_id, "tenant_id": tenant_id, "Authorization": f"Bearer {token}"}


@pytest.fixture
def internal_headers(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, "X-Internal-Token": get_settings().internal_token.get_secret_value()}
