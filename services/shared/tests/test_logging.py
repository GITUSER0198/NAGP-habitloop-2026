"""Request IDs and tenant context are isolated to the authenticated request."""

import json
import logging
from typing import Annotated
from uuid import uuid4

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from habitloop_shared.app_factory import create_app
from habitloop_shared.auth import CurrentUser, current_user, encode_token
from habitloop_shared.config import get_settings
from habitloop_shared.logging import JSONFormatter, request_id_context, tenant_id_context


def test_request_and_tenant_log_context() -> None:
    app = create_app("user-service", "/api/users")

    @app.get("/context")
    async def context(user: Annotated[CurrentUser, Depends(current_user)]) -> dict[str, object]:
        record = logging.LogRecord("test", logging.INFO, __file__, 1, "authenticated", (), None)
        return json.loads(JSONFormatter().format(record))

    with TestClient(app) as client:
        for _ in range(2):
            tenant_id = str(uuid4())
            request_id = str(uuid4())
            token = encode_token(uuid4(), tenant_id, "a@example.test", "A")
            response = client.get("/context", headers={
                "Authorization": f"Bearer {token}", "X-Request-ID": request_id,
            })
            assert response.json()["tenant_id"] == tenant_id
            assert response.json()["request_id"] == request_id
            assert response.json()["service"] == "user-service"
            assert response.headers["X-Request-ID"] == request_id
        health = client.get("/health")
        assert health.status_code == 200
        assert health.headers["X-Request-ID"] != request_id
    assert request_id_context.get() is None
    assert tenant_id_context.get() is None


def test_cors_uses_configured_web_port(monkeypatch: pytest.MonkeyPatch) -> None:
    # Use the registered host port provided by the environment, not a new port.
    monkeypatch.setenv("WEB_PORT", "47809")
    get_settings.cache_clear()
    app = create_app("user-service", "/api/users")
    with TestClient(app) as client:
        response = client.options("/api/users/health", headers={
            "Origin": "http://localhost:47809", "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        })
        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:47809"
