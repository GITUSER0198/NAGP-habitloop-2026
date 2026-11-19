"""Verify partner handler registration and dispatch through the authenticated worker."""

import runpy
import secrets
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from habitloop_shared.config import get_settings


def test_registered_normalizer_uses_plain_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    internal_token = secrets.token_urlsafe(32)
    monkeypatch.setenv("INTERNAL_TOKEN", internal_token)
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    get_settings.cache_clear()
    try:
        worker = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app" / "main.py"))
        assert len(worker["handlers"]["PartnerEventReceived"]) == 1
        received: list[dict[str, Any]] = []

        def normalize(event: dict[str, Any], context: Any) -> dict[str, Any]:
            received.append(event)
            assert context is None
            return {"batchItemFailures": []}

        monkeypatch.setattr(worker["normalizer"], "handler", normalize)
        detail = {"tenant_id": str(uuid4()), "partner_event_id": str(uuid4())}
        with TestClient(worker["app"]) as client:
            envelope = {"detail-type": "PartnerEventReceived", "detail": detail}
            assert client.post("/events", json=envelope).status_code == 401
            assert received == []
            assert client.post("/events", json=envelope, headers={
                "X-Internal-Token": internal_token,
            }).status_code == 202
            assert received == [detail]
    finally:
        get_settings.cache_clear()


def test_registered_analytics_uses_plain_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    internal_token = secrets.token_urlsafe(32)
    monkeypatch.setenv("INTERNAL_TOKEN", internal_token)
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    get_settings.cache_clear()
    try:
        worker = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app" / "main.py"))
        assert len(worker["handlers"]["ActivityLogged"]) == 1
        received: list[dict[str, Any]] = []

        def update(event: dict[str, Any], context: Any) -> dict[str, Any]:
            received.append(event)
            return {"batchItemFailures": []}

        monkeypatch.setattr(worker["analytics"], "handler", update)
        detail = {"tenant_id": str(uuid4()), "log_id": str(uuid4())}
        with TestClient(worker["app"]) as client:
            assert client.post("/events", json={"detail-type": "ActivityLogged", "detail": detail},
                               headers={"X-Internal-Token": internal_token}).status_code == 202
        assert received == [detail]
    finally:
        get_settings.cache_clear()
