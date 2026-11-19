"""Authentication, onboarding, profile validation and tenant isolation."""

import logging
from typing import Any
from uuid import UUID, uuid4

import bcrypt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from habitloop_shared.auth import decode_token, encode_token
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_engine

from app.models import Tenant, User

PREFIX = "/api/users"


def register(client: TestClient, **changes: Any) -> dict[str, Any]:
    response = client.post(f"{PREFIX}/register", json={
        "email": "person@example.com", "password": "correct horse battery staple",
        "name": "Person", "tenant_name": "Example Team", **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()


def bearer(account: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {account['token']}"}


def internal_headers(account: dict[str, Any]) -> dict[str, str]:
    return {
        **bearer(account),
        "X-Internal-Token": get_settings().internal_token.get_secret_value(),
    }


def test_register_profile_and_shared_jwt(client: TestClient) -> None:
    account = register(client)
    profile = account["user"]
    assert profile["timezone"] == "UTC"
    assert profile["name"] == "Person"
    assert profile["email"] == "person@example.com"
    assert UUID(profile["id"])
    assert UUID(profile["tenant_id"])
    assert profile["created_at"]
    assert "password" not in profile
    assert "password_hash" not in profile
    claims = decode_token(account["token"])
    assert claims["sub"] == profile["id"]
    assert claims["tenant_id"] == profile["tenant_id"]
    assert claims["email"] == profile["email"]
    assert claims["name"] == profile["name"]
    assert claims["exp"] - claims["iat"] == 3600
    response = client.get(f"{PREFIX}/me", headers=bearer(account))
    assert response.status_code == 200
    assert response.json()["id"] == profile["id"]
    with Session(get_engine()) as db:
        user = db.scalar(select(User).where(User.tenant_id == UUID(profile["tenant_id"])))
        assert user is not None
        assert user.password_hash != "correct horse battery staple"
        assert bcrypt.checkpw(b"correct horse battery staple", user.password_hash.encode())


def test_login_scoped_to_tenant_and_email(client: TestClient) -> None:
    first = register(client)
    second = register(client, tenant_name="Second Team", password="different password")
    assert first["user"]["tenant_id"] != second["user"]["tenant_id"]
    for slug, password, expected in (
        ("example-team", "correct horse battery staple", first),
        ("second-team", "different password", second),
    ):
        response = client.post(f"{PREFIX}/login", json={
            "tenant_slug": slug, "email": "PERSON@example.com", "password": password,
        })
        assert response.status_code == 200
        assert response.json()["user"]["id"] == expected["user"]["id"]
        assert decode_token(response.json()["token"])["tenant_id"] == expected["user"]["tenant_id"]
    assert client.post(f"{PREFIX}/login", json={
        "tenant_slug": "second-team", "email": "person@example.com",
        "password": "correct horse battery staple",
    }).status_code == 401


def test_existing_tenant_reused_and_duplicate_email_rejected(client: TestClient) -> None:
    first = register(client)
    second = register(client, tenant_name="EXAMPLE team", email="other@example.com")
    assert first["user"]["tenant_id"] == second["user"]["tenant_id"]
    response = client.post(f"{PREFIX}/register", json={
        "email": "PERSON@example.com", "password": "another password",
        "name": "Duplicate", "tenant_name": "Example Team",
    })
    assert response.status_code == 409
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(Tenant)) == 1
        assert db.scalar(select(func.count()).select_from(User).where(
            User.tenant_id == UUID(first["user"]["tenant_id"]),
        )) == 2


def test_failed_login_identical_errors_and_safe_logs(
    client: TestClient, caplog: pytest.LogCaptureFixture,
) -> None:
    register(client)
    caplog.set_level(logging.WARNING, logger="app.routers.users")
    bodies = []
    for slug, email in (
        ("example-team", "person@example.com"),
        ("example-team", "unknown@example.com"),
        ("unknown-team", "person@example.com"),
    ):
        response = client.post(f"{PREFIX}/login", json={
            "tenant_slug": slug, "email": email, "password": "incorrect password",
        })
        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == "Bearer"
        bodies.append(response.json())
    assert bodies == [{"detail": "Invalid email or password"}] * 3
    records = [record for record in caplog.records if record.getMessage() == "auth_failed"]
    assert [record.fields["tenant_slug"] for record in records] == [
        "example-team", "example-team", "unknown-team",
    ]
    assert "incorrect password" not in caplog.text
    assert "person@example.com" not in caplog.text


@pytest.mark.parametrize("password", ["", "x" * 73, "\u00e9" * 37])
def test_invalid_password_lengths_are_auth_failures(client: TestClient, password: str) -> None:
    register(client)
    for email in ("person@example.com", "unknown@example.com"):
        response = client.post(f"{PREFIX}/login", json={
            "tenant_slug": "example-team", "email": email, "password": password,
        })
        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid email or password"}


def test_tenant_lookup_uses_slug(client: TestClient) -> None:
    register(client, tenant_name="  Example, Team!  ")
    response = client.get(f"{PREFIX}/tenants/example-team")
    assert response.status_code == 200
    assert response.json() == {"exists": True, "name": "Example, Team!"}
    assert client.get(f"{PREFIX}/tenants/missing").json() == {"exists": False, "name": None}


def test_profile_patch_persists_and_preserves_other_fields(client: TestClient) -> None:
    account = register(client, timezone="Asia/Kolkata")
    headers = bearer(account)
    response = client.patch(f"{PREFIX}/me", headers=headers, json={"name": " Updated "})
    assert response.status_code == 200
    assert response.json()["name"] == "Updated"
    assert response.json()["timezone"] == "Asia/Kolkata"
    response = client.patch(f"{PREFIX}/me", headers=headers, json={"timezone": "America/New_York"})
    assert response.status_code == 200
    assert response.json()["name"] == "Updated"
    assert response.json()["timezone"] == "America/New_York"
    assert client.get(f"{PREFIX}/me", headers=headers).json() == response.json()
    assert client.patch(f"{PREFIX}/me", headers=headers, json={}).json() == response.json()
    login = client.post(f"{PREFIX}/login", json={
        "tenant_slug": "example-team", "email": "person@example.com",
        "password": "correct horse battery staple",
    })
    assert decode_token(login.json()["token"])["name"] == "Updated"


@pytest.mark.parametrize("patch", [
    {"name": " "}, {"name": None}, {"timezone": None}, {"timezone": "Not/A_Zone"},
    {"email": "other@example.com"}, {"tenant_id": str(uuid4())}, {"password": "changed"},
])
def test_invalid_profile_patch_leaves_profile_unchanged(
    client: TestClient, patch: dict[str, Any],
) -> None:
    account = register(client)
    before = client.get(f"{PREFIX}/me", headers=bearer(account)).json()
    assert client.patch(f"{PREFIX}/me", headers=bearer(account), json=patch).status_code == 422
    assert client.get(f"{PREFIX}/me", headers=bearer(account)).json() == before


def test_tenant_isolation_for_read_update_and_internal_profile(client: TestClient) -> None:
    first = register(client)
    second = register(client, tenant_name="Other Tenant")
    second_id = second["user"]["id"]
    second_tenant = second["user"]["tenant_id"]
    # A caller-supplied header never overrides the signed tenant claim.
    response = client.get(f"{PREFIX}/me", headers={**bearer(first), "X-Tenant-ID": second_tenant})
    assert response.json()["id"] == first["user"]["id"]
    assert client.get(
        f"{PREFIX}/internal/users/{second_id}", headers=internal_headers(first),
    ).status_code == 404
    mismatched = {"token": encode_token(
        second_id, first["user"]["tenant_id"], "person@example.com", "Person",
    )}
    assert client.get(f"{PREFIX}/me", headers=bearer(mismatched)).status_code == 404
    assert client.patch(
        f"{PREFIX}/me", headers=bearer(mismatched), json={"name": "Changed"},
    ).status_code == 404
    assert client.get(f"{PREFIX}/me", headers=bearer(second)).json()["name"] == "Person"


def test_internal_profile_requires_both_tokens_and_includes_timezone(client: TestClient) -> None:
    account = register(client, timezone="Asia/Kolkata")
    teammate = register(client, email="teammate@example.com")
    path = f"{PREFIX}/internal/users/{account['user']['id']}"
    for headers in (
        {}, bearer(account), {"X-Internal-Token": "invalid"},
        {"X-Internal-Token": get_settings().internal_token.get_secret_value()},
    ):
        assert client.get(path, headers=headers).status_code == 401
    response = client.get(path, headers=internal_headers(teammate))
    assert response.status_code == 200
    assert response.json()["timezone"] == "Asia/Kolkata"
    assert "password_hash" not in response.json()
    assert client.get(
        f"{PREFIX}/internal/users/{uuid4()}", headers=internal_headers(account),
    ).status_code == 404


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}])
def test_profile_requires_bearer(client: TestClient, headers: dict[str, str]) -> None:
    assert client.get(f"{PREFIX}/me", headers=headers).status_code == 401
    assert client.patch(f"{PREFIX}/me", headers=headers, json={"name": "Name"}).status_code == 401


@pytest.mark.parametrize("change", [
    {"email": "invalid"}, {"password": ""}, {"password": "x" * 73},
    {"password": "\u00e9" * 37}, {"name": " "}, {"tenant_name": "!!!"},
    {"timezone": "Unknown/Timezone"},
])
def test_invalid_registration(client: TestClient, change: dict[str, Any]) -> None:
    response = client.post(f"{PREFIX}/register", json={
        "email": "person@example.com", "password": "password", "name": "Person",
        "tenant_name": "Example Team", **change,
    })
    assert response.status_code == 422


def test_bcrypt_boundary_password_round_trip(client: TestClient) -> None:
    password = "\u00e9" * 36
    account = register(client, password=password)
    response = client.post(f"{PREFIX}/login", json={
        "tenant_slug": "example-team", "email": account["user"]["email"], "password": password,
    })
    assert response.status_code == 200


def test_swagger_lists_all_public_routes(client: TestClient) -> None:
    docs = client.get(f"{PREFIX}/docs")
    assert docs.status_code == 200
    assert f"{PREFIX}/openapi.json" in docs.text
    paths = client.get(f"{PREFIX}/openapi.json").json()["paths"]
    assert "post" in paths[f"{PREFIX}/register"]
    assert "post" in paths[f"{PREFIX}/login"]
    assert {"get", "patch"} <= paths[f"{PREFIX}/me"].keys()
    assert "get" in paths[f"{PREFIX}/tenants/{{slug}}"]
    assert f"{PREFIX}/internal/users/{{id}}" not in paths
