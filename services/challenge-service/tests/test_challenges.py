"""Visibility, invitations, membership, invite codes and tenant boundaries."""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from habitloop_shared.auth import encode_token
from habitloop_shared.db import get_engine

PREFIX = "/api/challenges"


def create(client: TestClient, headers: dict[str, str], **values: Any) -> dict[str, Any]:
    today = datetime.now(timezone.utc).date()
    response = client.post(PREFIX, headers=headers, json={
        "title": "Daily run", "activity_category": "fitness", "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=7)).isoformat(), "target_count": 7, **values,
    })
    assert response.status_code == 201, response.text
    return response.json()


def invite(client: TestClient, headers: dict[str, str], challenge_id: str, user_id: str) -> dict[str, Any]:
    response = client.post(f"{PREFIX}/{challenge_id}/invites", headers=headers, json={"user_ids": [user_id]})
    assert response.status_code == 200, response.text
    return response.json()


def test_creation_public_feed_and_private_visibility(
    client: TestClient, headers: dict[str, str], identity: dict[str, str], peer: dict[str, str],
) -> None:
    public = create(client, headers)
    private = create(client, headers, visibility="private")
    assert public["tenant_id"] == identity["tenant_id"]
    assert public["owner_id"] == identity["user_id"]
    assert len(public["invite_code"]) == 8
    assert set(item["id"] for item in client.get(f"{PREFIX}/feed", headers=headers).json()) == {
        public["id"], private["id"],
    }
    assert [item["id"] for item in client.get(f"{PREFIX}/feed", headers=peer).json()] == [public["id"]]
    visible = client.get(f"{PREFIX}/{public['id']}", headers=peer)
    assert visible.status_code == 200
    assert "invite_code" not in visible.json()
    assert client.get(f"{PREFIX}/{private['id']}", headers=peer).status_code == 404
    assert client.post(f"{PREFIX}/{private['id']}/join", headers=peer).status_code == 404
    assert client.get(f"{PREFIX}/{uuid4()}", headers=headers).status_code == 404


def test_public_join_leave_and_rejoin(
    client: TestClient, headers: dict[str, str], peer: dict[str, str],
) -> None:
    challenge = create(client, headers)
    path = f"{PREFIX}/{challenge['id']}"
    joined = client.post(f"{path}/join", headers=peer)
    assert joined.status_code == 200
    assert joined.json()["status"] == "joined"
    assert joined.json()["user_id"] == peer["user_id"]
    assert joined.json()["joined_at"].endswith("Z")
    assert client.post(f"{path}/join", headers=peer).json() == joined.json()
    left = client.post(f"{path}/leave", headers=peer)
    assert left.status_code == 200
    assert left.json()["status"] == "left"
    assert client.post(f"{path}/leave", headers=peer).json() == left.json()
    assert client.post(f"{path}/join", headers=peer).json()["status"] == "joined"


def test_invite_acceptance_idempotency_and_private_feed(
    client: TestClient, headers: dict[str, str], peer: dict[str, str],
    recipients: dict[str, Any], internal_headers: dict[str, str],
) -> None:
    from app.models import Participant

    challenge = create(client, headers, visibility="private")
    result = invite(client, headers, challenge["id"], peer["user_id"])
    assert result == {"invite_code": challenge["invite_code"], "user_ids": [peer["user_id"]]}
    request = recipients["requests"][-1]
    assert request.headers["Authorization"] == headers["Authorization"]
    assert request.headers["X-Internal-Token"] == internal_headers["X-Internal-Token"]
    assert request.url.path == f"/api/users/internal/users/{peer['user_id']}"
    assert [item["id"] for item in client.get(f"{PREFIX}/invites", headers=peer).json()] == [challenge["id"]]
    assert [item["id"] for item in client.get(f"{PREFIX}/feed", headers=peer).json()] == [challenge["id"]]
    assert client.get(f"{PREFIX}/{challenge['id']}", headers=peer).status_code == 200
    # Direct joins never bypass the private invitation flow.
    assert client.post(f"{PREFIX}/{challenge['id']}/join", headers=peer).status_code == 409
    path = f"{PREFIX}/invites/{challenge['id']}/accept"
    accepted = client.post(path, headers=peer)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "joined"
    assert client.post(path, headers=peer).json() == accepted.json()
    assert client.get(f"{PREFIX}/invites", headers=peer).json() == []
    invite(client, headers, challenge["id"], peer["user_id"])
    assert client.get(f"{PREFIX}/invites", headers=peer).json() == []
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(Participant).where(
            Participant.tenant_id == UUID(challenge["tenant_id"]),
            Participant.challenge_id == UUID(challenge["id"]), Participant.user_id == UUID(peer["user_id"]),
        )) == 1


def test_decline_reinvite_and_leave_hide_private_challenge(
    client: TestClient, headers: dict[str, str], peer: dict[str, str],
) -> None:
    challenge = create(client, headers, visibility="private")
    path = f"{PREFIX}/{challenge['id']}"
    invite(client, headers, challenge["id"], peer["user_id"])
    decline = f"{PREFIX}/invites/{challenge['id']}/decline"
    response = client.post(decline, headers=peer)
    assert response.status_code == 200
    assert response.json()["status"] == "declined"
    assert client.post(decline, headers=peer).json() == response.json()
    assert client.get(f"{PREFIX}/invites", headers=peer).json() == []
    assert client.get(f"{PREFIX}/feed", headers=peer).json() == []
    assert client.get(path, headers=peer).status_code == 404
    accept = f"{PREFIX}/invites/{challenge['id']}/accept"
    assert client.post(accept, headers=peer).status_code == 404
    invite(client, headers, challenge["id"], peer["user_id"])
    assert client.post(accept, headers=peer).status_code == 200
    assert client.post(decline, headers=peer).status_code == 409
    assert client.post(f"{path}/leave", headers=peer).json()["status"] == "left"
    assert client.get(path, headers=peer).status_code == 404
    assert client.get(f"{PREFIX}/feed", headers=peer).json() == []
    invite(client, headers, challenge["id"], peer["user_id"])
    assert client.post(accept, headers=peer).status_code == 200


def test_join_private_by_code_and_leave(
    client: TestClient, headers: dict[str, str], peer: dict[str, str],
) -> None:
    challenge = create(client, headers, visibility="private")
    code_only = client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers, json={})
    assert code_only.json() == {"invite_code": challenge["invite_code"], "user_ids": []}
    assert client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers).json() == code_only.json()
    joined = client.post(f"{PREFIX}/join-by-code", headers=peer, json={"invite_code": challenge["invite_code"]})
    assert joined.status_code == 200
    assert joined.json()["status"] == "joined"
    assert client.post(f"{PREFIX}/join-by-code", headers=peer,
                       json={"invite_code": challenge["invite_code"]}).json() == joined.json()
    assert client.get(f"{PREFIX}/{challenge['id']}", headers=peer).status_code == 200
    assert client.post(f"{PREFIX}/{challenge['id']}/leave", headers=peer).status_code == 200
    assert client.get(f"{PREFIX}/{challenge['id']}", headers=peer).status_code == 404


@pytest.mark.parametrize("visibility", ["public", "private"])
def test_every_join_path_rejects_ended_challenges(
    client: TestClient, headers: dict[str, str], peer: dict[str, str], visibility: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import challenges

    challenge = create(client, headers, visibility=visibility)
    invite(client, headers, challenge["id"], peer["user_id"])
    end = datetime.fromisoformat(challenge["end_date"]).date()
    monkeypatch.setattr(challenges, "today", lambda: end + timedelta(days=1))
    assert client.post(f"{PREFIX}/join-by-code", headers=peer,
                       json={"invite_code": challenge["invite_code"]}).status_code == 409
    assert client.post(f"{PREFIX}/invites/{challenge['id']}/accept", headers=peer).status_code == 409
    assert client.post(f"{PREFIX}/{challenge['id']}/join", headers=peer).status_code == 409
    assert client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers, json={}).status_code == 409
    monkeypatch.setattr(challenges, "today", lambda: end)
    assert client.post(f"{PREFIX}/invites/{challenge['id']}/accept", headers=peer).status_code == 200
    monkeypatch.setattr(challenges, "today", lambda: end + timedelta(days=1))
    assert client.post(f"{PREFIX}/invites/{challenge['id']}/accept", headers=peer).status_code == 200


@pytest.mark.parametrize("visibility", ["public", "private"])
def test_cross_tenant_resources_and_invite_code(
    client: TestClient, headers: dict[str, str], peer: dict[str, str], foreign: dict[str, str],
    identity: dict[str, str], internal_headers: dict[str, str], visibility: str,
) -> None:
    challenge = create(client, headers, visibility=visibility)
    invite(client, headers, challenge["id"], peer["user_id"])
    path = f"{PREFIX}/{challenge['id']}"
    assert client.get(path, headers=foreign).status_code == 404
    for suffix, body in (("join", None), ("leave", None), ("invites", {"user_ids": [foreign["user_id"]]})):
        assert client.post(f"{path}/{suffix}", headers=foreign, json=body).status_code == 404
    for action in ("accept", "decline"):
        assert client.post(f"{PREFIX}/invites/{challenge['id']}/{action}", headers=foreign).status_code == 404
    assert client.post(f"{PREFIX}/join-by-code", headers=foreign,
                       json={"invite_code": challenge["invite_code"]}).status_code == 404
    # The same user UUID in another tenant cannot discover pending invites or joined rows.
    token = encode_token(peer["user_id"], foreign["tenant_id"], "peer@example.com", "Peer")
    same_user_foreign_tenant = {"Authorization": f"Bearer {token}"}
    for endpoint in ("feed", "invites"):
        assert client.get(f"{PREFIX}/{endpoint}", headers=same_user_foreign_tenant).json() == []
    assert client.post(f"{PREFIX}/invites/{challenge['id']}/accept", headers=same_user_foreign_tenant).status_code == 404
    active = client.get(f"{PREFIX}/internal/users/{identity['user_id']}/active",
                        headers={**internal_headers, **foreign})
    assert active.status_code == 200
    assert active.json() == []


def test_invite_authorization_and_missing_participation(
    client: TestClient, headers: dict[str, str], peer: dict[str, str],
) -> None:
    challenge = create(client, headers)
    path = f"{PREFIX}/{challenge['id']}"
    assert client.post(f"{path}/invites", headers=peer, json={}).status_code == 403
    assert client.post(f"{path}/leave", headers=peer).status_code == 404
    for action in ("accept", "decline"):
        assert client.post(f"{PREFIX}/invites/{challenge['id']}/{action}", headers=peer).status_code == 404
    assert client.post(f"{PREFIX}/{uuid4()}/invites", headers=headers, json={}).status_code == 404


def test_recipient_tenant_validation_is_atomic(
    client: TestClient, headers: dict[str, str], peer: dict[str, str], foreign: dict[str, str],
    recipients: dict[str, Any],
) -> None:
    challenge = create(client, headers)
    recipients["missing"].add(foreign["user_id"])
    response = client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers,
                           json={"user_ids": [peer["user_id"], foreign["user_id"]]})
    assert response.status_code == 404
    assert client.get(f"{PREFIX}/invites", headers=peer).json() == []
    recipients["status"] = 503
    assert client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers,
                       json={"user_ids": [peer["user_id"]]}).status_code == 503
    assert client.get(f"{PREFIX}/invites", headers=peer).json() == []
    recipients["status"] = 200
    result = client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers,
                         json={"user_ids": [peer["user_id"], peer["user_id"]]})
    assert result.status_code == 200
    assert result.json()["user_ids"] == [peer["user_id"]]
    assert len(client.get(f"{PREFIX}/invites", headers=peer).json()) == 1


def test_active_internal_filters_dates_membership_category_and_tenant(
    client: TestClient, headers: dict[str, str], peer: dict[str, str], identity: dict[str, str],
    internal_headers: dict[str, str],
) -> None:
    today = datetime.now(timezone.utc).date()
    active = create(client, headers, start_date=today.isoformat(), end_date=today.isoformat())
    mind = create(client, headers, activity_category="mind")
    create(client, headers, start_date=(today + timedelta(days=1)).isoformat())
    create(client, headers, start_date=(today - timedelta(days=2)).isoformat(),
           end_date=(today - timedelta(days=1)).isoformat())
    path = f"{PREFIX}/internal/users/{identity['user_id']}/active"
    assert set(client.get(path, headers=internal_headers).json()) == {active["id"], mind["id"]}
    assert client.get(path, headers=internal_headers, params={"category": "fitness"}).json() == [active["id"]]
    assert client.get(path, headers=internal_headers, params={"category": "missing"}).json() == []
    peer_path = f"{PREFIX}/internal/users/{peer['user_id']}/active"
    assert client.get(peer_path, headers=internal_headers).json() == []
    invite(client, headers, active["id"], peer["user_id"])
    assert client.get(peer_path, headers=internal_headers).json() == []
    client.post(f"{PREFIX}/invites/{active['id']}/decline", headers=peer)
    assert client.get(peer_path, headers=internal_headers).json() == []
    client.post(f"{PREFIX}/{active['id']}/join", headers=peer)
    assert client.get(peer_path, headers=internal_headers).json() == [active["id"]]
    client.post(f"{PREFIX}/{active['id']}/leave", headers=peer)
    assert client.get(peer_path, headers=internal_headers).json() == []
    assert client.get(path, headers=headers).status_code == 401
    assert client.get(path, headers={"X-Internal-Token": internal_headers["X-Internal-Token"]}).status_code == 401
    assert client.get(path, headers={**headers, "X-Internal-Token": "invalid"}).status_code == 401


def test_invite_codes_retry_collisions_and_are_unique_per_tenant(
    client: TestClient, headers: dict[str, str], foreign: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import challenges

    first = create(client, headers)
    codes = iter([first["invite_code"], "23456789"])
    monkeypatch.setattr(challenges, "generate_invite_code", lambda: next(codes))
    second = create(client, headers)
    assert second["invite_code"] == "23456789"
    monkeypatch.setattr(challenges, "generate_invite_code", lambda: first["invite_code"])
    other = create(client, foreign, visibility="private")
    assert other["invite_code"] == first["invite_code"]
    joined = client.post(f"{PREFIX}/join-by-code", headers=foreign, json={"invite_code": first["invite_code"]})
    assert joined.status_code == 200
    assert joined.json()["challenge_id"] == other["id"]
    response = client.post(PREFIX, headers=headers, json={
        key: first[key] for key in ("title", "activity_category", "start_date", "end_date", "target_count")
    })
    assert response.status_code == 503
    assert len(client.get(f"{PREFIX}/feed", headers=headers).json()) == 2


@pytest.mark.parametrize("changes", [
    {"title": " "}, {"visibility": "secret"}, {"activity_category": " "},
    {"target_count": 0}, {"target_count": True}, {"start_date": "invalid"},
    {"start_date": "2030-01-02", "end_date": "2030-01-01"}, {"tenant_id": str(uuid4())},
])
def test_invalid_creation(client: TestClient, headers: dict[str, str], changes: dict[str, Any]) -> None:
    response = client.post(PREFIX, headers=headers, json={
        "title": "Run", "activity_category": "fitness", "target_count": 1,
        "start_date": "2030-01-01", "end_date": "2030-01-02", **changes,
    })
    assert response.status_code == 422


@pytest.mark.parametrize("code", ["short", "123456789", "abcdefgh", "!!!!!!!!", ""])
def test_invalid_invite_code(client: TestClient, headers: dict[str, str], code: str) -> None:
    assert client.post(f"{PREFIX}/join-by-code", headers=headers, json={"invite_code": code}).status_code == 422


def test_unknown_code_and_invalid_recipient(client: TestClient, headers: dict[str, str]) -> None:
    assert client.post(f"{PREFIX}/join-by-code", headers=headers,
                       json={"invite_code": "00000000"}).status_code == 404
    challenge = create(client, headers)
    assert client.post(f"{PREFIX}/{challenge['id']}/invites", headers=headers,
                       json={"user_ids": ["invalid"]}).status_code == 422


def test_public_routes_require_authentication(client: TestClient, headers: dict[str, str]) -> None:
    challenge = create(client, headers)
    path = f"{PREFIX}/{challenge['id']}"
    for endpoint in (f"{PREFIX}/feed", f"{PREFIX}/invites", path):
        assert client.get(endpoint).status_code == 401
    for endpoint, body in (
        (PREFIX, {}), (f"{path}/join", None), (f"{path}/leave", None), (f"{path}/invites", {}),
        (f"{PREFIX}/join-by-code", {"invite_code": challenge["invite_code"]}),
        (f"{PREFIX}/invites/{challenge['id']}/accept", None),
        (f"{PREFIX}/invites/{challenge['id']}/decline", None),
    ):
        assert client.post(endpoint, json=body).status_code == 401


def test_gateway_collection_slash(client: TestClient, headers: dict[str, str]) -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    response = client.post(PREFIX + "/", headers=headers, follow_redirects=False, json={
        "title": "Run", "activity_category": "fitness", "target_count": 1,
        "start_date": today, "end_date": today,
    })
    assert response.status_code == 201
