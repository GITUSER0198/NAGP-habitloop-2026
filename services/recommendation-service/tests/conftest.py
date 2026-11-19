"""Isolated database, authenticated identities and mocked service boundaries."""

import json
import secrets
import sys
from collections.abc import Iterator
from datetime import datetime, timezone
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
NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DB_SCHEMA", "recommendations")
    get_settings.cache_clear()
    get_engine().dispose()
    yield
    get_engine().dispose()
    get_settings.cache_clear()


@pytest.fixture
def identity() -> dict[str, str]:
    return {"tenant_id": str(uuid4()), "user_id": str(uuid4())}


@pytest.fixture
def headers(identity: dict[str, str]) -> dict[str, str]:
    token = encode_token(**identity, email="test@example.com", name="Tester")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def downstream(monkeypatch: pytest.MonkeyPatch, identity: dict[str, str]) -> dict[str, Any]:
    state: dict[str, Any] = {
        "activities": [{
            "id": str(uuid4()), **identity, "name": "Running", "active": True,
            "frequency": "daily", "preferred_time": "20:30", "target_per_week": 7,
        }],
        "hours": [], "logs": [], "requests": [], "effects": [], "patch_status": 200,
        "history_status": 200, "transport_error": False, "event_error": False,
    }
    real_client = httpx.Client

    def handle(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        if state["transport_error"]:
            raise httpx.ConnectError("Service unavailable", request=request)
        if request.method == "PATCH":
            state["effects"].append(("patch", json.loads(request.content)))
            if state["patch_status"] == 200:
                for activity in state["activities"]:
                    if activity["id"] in request.url.path:
                        activity.update(json.loads(request.content))
            return httpx.Response(state["patch_status"], json={})
        if request.url.path.endswith("/hours"):
            payload = state["hours"]
        elif request.url.path.endswith("/logs"):
            payload = state["logs"]
        elif request.url.path == "/api/activities":
            payload = state["activities"]
        else:
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        return httpx.Response(state["history_status"], json=payload)

    def make_client(**kwargs: Any) -> httpx.Client:
        return real_client(transport=httpx.MockTransport(handle), **kwargs)

    def publish(kind: str, detail: dict[str, Any]) -> None:
        if state["event_error"]:
            raise RuntimeError("Event bus unavailable")
        state["effects"].append((kind, detail))

    monkeypatch.setattr(httpx, "Client", make_client)
    monkeypatch.setattr(events, "publish", publish)
    return state


@pytest.fixture
def client(downstream: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from app import routes
    from app.main import app

    monkeypatch.setattr(routes, "now", lambda: NOW)
    with TestClient(app) as client:
        yield client
