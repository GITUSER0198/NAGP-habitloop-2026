"""JWT and internal authentication behavior at the HTTP boundary."""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import uuid4

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from pydantic import ValidationError

from habitloop_shared.app_factory import create_app
from habitloop_shared.auth import CurrentUser, current_user, decode_token, encode_token, internal_only
from habitloop_shared.config import get_settings


def test_jwt_round_trip() -> None:
    user_id, tenant_id = str(uuid4()), str(uuid4())
    claims = decode_token(encode_token(user_id, tenant_id, "person@example.test", "Person"))
    assert claims["sub"] == user_id
    assert claims["tenant_id"] == tenant_id
    assert claims["email"] == "person@example.test"
    assert claims["name"] == "Person"
    assert claims["exp"] - claims["iat"] == 3600


def test_bad_tokens_return_401() -> None:
    app = create_app("user-service", "/api/users")

    @app.get("/protected")
    async def protected(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:
        return user

    expired = {
        "sub": str(uuid4()), "tenant_id": str(uuid4()), "email": "a@example.test", "name": "A",
        "iat": datetime.now(timezone.utc) - timedelta(hours=2),
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
    }
    secret = get_settings().jwt_secret.get_secret_value()
    good = decode_token(encode_token(uuid4(), uuid4(), "a@example.test", "A"))
    tokens = [
        None, "not-a-jwt", jwt.encode(expired, secret, algorithm="HS256"),
        jwt.encode(good, secrets.token_urlsafe(32), algorithm="HS256"),
        jwt.encode(good, secret, algorithm="HS384"),
        jwt.encode({key: value for key, value in good.items() if key != "tenant_id"}, secret, algorithm="HS256"),
        jwt.encode({**good, "tenant_id": "invalid"}, secret, algorithm="HS256"),
    ]
    with TestClient(app) as client:
        for token in tokens:
            headers = {} if token is None else {"Authorization": f"Bearer {token}"}
            response = client.get("/protected", headers=headers)
            assert response.status_code == 401
            assert response.headers["WWW-Authenticate"] == "Bearer"


def test_identity_comes_from_each_tokens_tenant() -> None:
    app = create_app("user-service", "/api/users")

    @app.get("/identity")
    async def identity(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:
        return user

    with TestClient(app) as client:
        for _ in range(2):
            user_id, tenant_id = str(uuid4()), str(uuid4())
            token = encode_token(user_id, tenant_id, "a@example.test", "A")
            response = client.get("/identity", headers={
                "Authorization": f"Bearer {token}", "X-Tenant-ID": str(uuid4()),
            })
            assert response.json() == {"user_id": user_id, "tenant_id": tenant_id}


def test_internal_token_required() -> None:
    app = create_app("user-service", "/api/users")

    @app.get("/internal", dependencies=[Depends(internal_only)])
    async def internal() -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as client:
        assert client.get("/internal").status_code == 401
        assert client.get("/internal", headers={"X-Internal-Token": "wrong"}).status_code == 401
        assert client.get("/internal", headers={
            "X-Internal-Token": get_settings().internal_token.get_secret_value(),
        }).status_code == 200


@pytest.mark.parametrize("value", [None, "", "   "])
def test_missing_jwt_secret_fails_before_startup(monkeypatch: pytest.MonkeyPatch, value: str | None) -> None:
    if value is None:
        monkeypatch.delenv("JWT_SECRET")
    else:
        monkeypatch.setenv("JWT_SECRET", value)
    get_settings.cache_clear()
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        create_app("user-service", "/api/users")
