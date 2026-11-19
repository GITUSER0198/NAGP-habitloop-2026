"""Exercise the service entry point and its externally routed health endpoint."""

import runpy
import secrets
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from habitloop_shared.config import get_settings


def test_health(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(32))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("DB_SCHEMA", "activities")
    get_settings.cache_clear()
    try:
        entrypoint = Path(__file__).resolve().parents[1] / "app" / "main.py"
        app = runpy.run_path(str(entrypoint))["app"]
        with TestClient(app) as client:
            for path in ("/health", "/api/activities/health"):
                response = client.get(path)
                assert response.status_code == 200
                assert response.json() == {"status": "ok", "service": "activity-service"}
                assert response.headers["X-Request-ID"]
            assert client.get("/docs").status_code == 200
            assert client.get("/api/activities/docs").status_code == 200
            assert client.get("/api/activities/openapi.json").status_code == 200
    finally:
        get_settings.cache_clear()
