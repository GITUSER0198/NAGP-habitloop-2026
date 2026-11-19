"""JWT authentication and service-to-service authentication dependencies."""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, TypedDict
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from habitloop_shared.config import get_settings
from habitloop_shared.logging import tenant_id_context

bearer = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


class CurrentUser(TypedDict):
    user_id: str
    tenant_id: str


def encode_token(user_id: str | UUID, tenant_id: str | UUID, email: str, name: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(UUID(str(user_id))), "tenant_id": str(UUID(str(tenant_id))),
         "email": email, "name": name, "iat": now, "exp": now + timedelta(minutes=60)},
        get_settings().jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def decode_token(token: str) -> dict[str, Any]:
    claims: dict[str, Any] = jwt.decode(
        token, get_settings().jwt_secret.get_secret_value(), algorithms=["HS256"],
        options={"require": ["sub", "tenant_id", "email", "name", "iat", "exp"]},
    )
    try:
        for key in ("sub", "tenant_id", "email", "name"):
            if not isinstance(claims[key], str) or not claims[key].strip():
                raise ValueError("invalid claim")
        UUID(claims["sub"])
        UUID(claims["tenant_id"])
    except (ValueError, TypeError) as exc:
        raise jwt.InvalidTokenError("Invalid identity claims") from exc
    return claims


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> CurrentUser:
    try:
        if credentials is None:
            raise jwt.InvalidTokenError("Missing bearer token")
        claims = decode_token(credentials.credentials)
    except jwt.InvalidTokenError:
        logger.warning("auth_failed")
        raise HTTPException(
            status_code=401, detail="Invalid or missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    tenant_id_context.set(claims["tenant_id"])
    return {"user_id": claims["sub"], "tenant_id": claims["tenant_id"]}


async def internal_only(
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    expected = get_settings().internal_token.get_secret_value()
    if x_internal_token is None or not secrets.compare_digest(
        x_internal_token.encode("utf-8"), expected.encode("utf-8"),
    ):
        logger.warning("auth_failed", extra={"fields": {"auth_kind": "internal"}})
        raise HTTPException(status_code=401, detail="Invalid or missing internal token")
