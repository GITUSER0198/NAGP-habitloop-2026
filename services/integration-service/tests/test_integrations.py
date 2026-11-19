"""Link ownership, exact-body HMAC, replay protection and normalization status."""

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from habitloop_shared import events
from habitloop_shared.auth import encode_token
from habitloop_shared.db import get_engine

PREFIX = "/api/integrations"


def create(client: TestClient, headers: dict[str, str], **values: Any) -> dict[str, Any]:
    response = client.post(f"{PREFIX}/links", headers=headers, json={
        "provider": "mockfit", "activity_map": {"run": str(uuid4())}, **values,
    })
    assert response.status_code == 201, response.text
    return response.json()


def workout(**values: Any) -> dict[str, Any]:
    return {
        "event_id": str(uuid4()), "type": "workout", "provider_activity": "run",
        "started_at": "2026-11-19T09:00:00+05:30", "duration_min": 25, "steps": 5500, **values,
    }


def send(client: TestClient, link: dict[str, Any], payload: dict[str, Any]) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(link["ingest_key"].encode("ascii"), body, hashlib.sha256).hexdigest()
    return client.post(f"{PREFIX}/ingest/{link['id']}", content=body, headers={
        "Content-Type": "application/json", "X-HabitLoop-Signature": f"sha256={signature}",
    })


def test_provider_links_key_disclosure_and_soft_deletion(
    client: TestClient, headers: dict[str, str], identity: dict[str, str], downstream: dict[str, Any],
) -> None:
    from app.models import Link

    providers = client.get(f"{PREFIX}/providers", headers=headers).json()
    assert {item["provider"] for item in providers} == {"mockfit", "mockrun"}
    assert all("run" in item["activity_types"] for item in providers)
    link = create(client, headers)
    assert link["tenant_id"] == identity["tenant_id"]
    assert link["user_id"] == identity["user_id"]
    assert downstream["requests"][-1].headers["Authorization"] == headers["Authorization"]
    with Session(get_engine()) as db:
        stored = db.scalar(select(Link).where(Link.tenant_id == UUID(identity["tenant_id"])))
        assert stored.ingest_key_hash == hashlib.sha256(link["ingest_key"].encode()).hexdigest()
        assert stored.ingest_key_hash != link["ingest_key"]
    listed = client.get(f"{PREFIX}/links", headers=headers).json()
    assert len(listed) == 1
    assert "ingest_key" not in listed[0] and "ingest_key_hash" not in listed[0]
    assert client.delete(f"{PREFIX}/links/{link['id']}", headers=headers).status_code == 204
    assert client.get(f"{PREFIX}/links", headers=headers).json() == []
    assert send(client, link, workout()).status_code == 404
    assert client.delete(f"{PREFIX}/links/{link['id']}", headers=headers).status_code == 404
    assert client.get(f"{PREFIX}/links/{link['id']}/events", headers=headers).status_code == 404


def test_signed_workout_publishes_once_and_replay_does_not_write(
    client: TestClient, headers: dict[str, str], identity: dict[str, str], emitted: list[Any],
) -> None:
    from app.models import PartnerEvent

    link = create(client, headers)
    payload = workout()
    response = send(client, link, payload)
    assert response.status_code == 202, response.text
    assert emitted == [("PartnerEventReceived", {
        "tenant_id": identity["tenant_id"], "user_id": identity["user_id"], "link_id": link["id"],
        "partner_event_id": response.json()["id"], "provider": "mockfit", "raw": payload,
    })]
    for _ in range(2):
        duplicate = send(client, link, payload)
        assert duplicate.status_code == 200 and duplicate.json() == {"duplicate": True}
    assert len(emitted) == 1
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(PartnerEvent).where(
            PartnerEvent.tenant_id == UUID(identity["tenant_id"]),
        )) == 1
    # Event IDs are scoped to a link, not global across providers or devices.
    second_link = create(client, headers, provider="mockrun")
    assert send(client, second_link, payload).status_code == 202
    assert len(emitted) == 2


@pytest.mark.parametrize("signature", [None, "sha256=bad", "sha256=" + "0" * 64, "sha256=\u00e9"])
def test_bad_signature_stores_and_publishes_nothing(
    client: TestClient, headers: dict[str, str], emitted: list[Any], signature: str | None,
) -> None:
    link = create(client, headers)
    signature_headers = {} if signature is None else {"X-HabitLoop-Signature": signature.encode("utf-8")}
    response = client.post(f"{PREFIX}/ingest/{link['id']}", content=b"{}", headers=signature_headers)
    assert response.status_code == 401
    assert client.get(f"{PREFIX}/links/{link['id']}/events", headers=headers).json() == []
    assert emitted == []


def test_signature_is_over_exact_body(client: TestClient, headers: dict[str, str]) -> None:
    link = create(client, headers)
    body = json.dumps(workout()).encode()
    signature = hmac.new(link["ingest_key"].encode(), body, hashlib.sha256).hexdigest()
    assert client.post(f"{PREFIX}/ingest/{link['id']}", content=body + b" ", headers={
        "X-HabitLoop-Signature": f"sha256={signature}",
    }).status_code == 401


@pytest.mark.parametrize("changes", [
    {"type": "sleep"}, {"started_at": "2026-11-19T09:00:00"}, {"started_at": "bad"},
    {"duration_min": -1}, {"duration_min": True}, {"steps": -1}, {"steps": 1.5},
    {"event_id": ""}, {"event_id": "x" * 256},
])
def test_signed_invalid_payload_is_not_stored(
    client: TestClient, headers: dict[str, str], changes: dict[str, Any], emitted: list[Any],
) -> None:
    link = create(client, headers)
    assert send(client, link, workout(**changes)).status_code == 422
    assert client.get(f"{PREFIX}/links/{link['id']}/events", headers=headers).json() == []
    assert emitted == []


def test_cross_tenant_and_same_tenant_peer_cannot_access_links_or_events(
    client: TestClient, headers: dict[str, str], identity: dict[str, str], internal_headers: dict[str, str],
) -> None:
    link = create(client, headers)
    event_id = send(client, link, workout()).json()["id"]
    for tenant_id in (identity["tenant_id"], str(uuid4())):
        token = encode_token(uuid4(), tenant_id, "other@example.com", "Other")
        other = {"Authorization": f"Bearer {token}"}
        assert client.get(f"{PREFIX}/links", headers=other).json() == []
        assert client.delete(f"{PREFIX}/links/{link['id']}", headers=other).status_code == 404
        assert client.get(f"{PREFIX}/links/{link['id']}/events", headers=other).status_code == 404
        assert client.patch(f"{PREFIX}/internal/events/{event_id}", json={"status": "normalized"}, headers={
            **other, "X-Internal-Token": internal_headers["X-Internal-Token"],
        }).status_code == 404


def test_status_update_internal_auth_reason_and_idempotency(
    client: TestClient, headers: dict[str, str], internal_headers: dict[str, str],
) -> None:
    link = create(client, headers)
    event_id = send(client, link, workout(provider_activity="yoga")).json()["id"]
    path = f"{PREFIX}/internal/events/{event_id}"
    rejection = {"status": "rejected", "reason": "Unmapped provider activity: yoga"}
    assert client.patch(path, json=rejection, headers=headers).status_code == 401
    assert client.patch(path, json=rejection, headers={
        "X-Internal-Token": internal_headers["X-Internal-Token"],
    }).status_code == 401
    assert client.patch(path, json={"status": "rejected"}, headers=internal_headers).status_code == 200
    for _ in range(2):
        result = client.patch(path, json=rejection, headers=internal_headers)
        assert result.status_code == 200
        assert result.json()["reason"] == rejection["reason"]
    listed = client.get(f"{PREFIX}/links/{link['id']}/events", headers=headers).json()[0]
    assert listed["status"] == "rejected" and listed["reason"] == rejection["reason"]
    assert client.patch(path, json={"status": "normalized"}, headers=internal_headers).status_code == 200
    assert client.patch(f"{PREFIX}/internal/events/{uuid4()}", json=rejection, headers=internal_headers).status_code == 404


def test_last_fifty_events_ordered_newest_first(client: TestClient, headers: dict[str, str]) -> None:
    from app.models import PartnerEvent

    link = create(client, headers)
    now = datetime.now(timezone.utc)
    with Session(get_engine()) as db:
        db.add_all(PartnerEvent(
            tenant_id=UUID(link["tenant_id"]), link_id=UUID(link["id"]), event_id=str(index),
            payload=workout(), received_at=now + timedelta(seconds=index),
        ) for index in range(55))
        db.commit()
    result = client.get(f"{PREFIX}/links/{link['id']}/events", headers=headers).json()
    assert [item["event_id"] for item in result] == [str(index) for index in range(54, 4, -1)]


def test_event_committed_before_local_dispatch(
    client: TestClient, headers: dict[str, str], internal_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    link = create(client, headers)

    def dispatch(kind: str, detail: dict[str, Any]) -> None:
        assert kind == "PartnerEventReceived"
        result = client.patch(
            f"{PREFIX}/internal/events/{detail['partner_event_id']}", headers=internal_headers,
            json={"status": "normalized"},
        )
        assert result.status_code == 200

    monkeypatch.setattr(events, "publish", dispatch)
    assert send(client, link, workout()).status_code == 202
    assert client.get(f"{PREFIX}/links/{link['id']}/events", headers=headers).json()[0]["status"] == "normalized"


def test_link_map_validation_and_required_auth(
    client: TestClient, headers: dict[str, str], downstream: dict[str, Any],
) -> None:
    assert client.get(f"{PREFIX}/providers").status_code == 401
    assert client.get(f"{PREFIX}/links").status_code == 401
    for body in (
        {"provider": "unknown", "activity_map": {}},
        {"provider": "mockrun", "activity_map": {"swim": str(uuid4())}},
        {"provider": "mockfit", "activity_map": {"run": "not-a-uuid"}},
    ):
        assert client.post(f"{PREFIX}/links", headers=headers, json=body).status_code == 422
    downstream["status"] = 404
    assert client.post(f"{PREFIX}/links", headers=headers, json={
        "provider": "mockfit", "activity_map": {"run": str(uuid4())},
    }).status_code == 422
    downstream["status"] = 503
    assert client.post(f"{PREFIX}/links", headers=headers, json={
        "provider": "mockfit", "activity_map": {"run": str(uuid4())},
    }).status_code == 502
    assert create(client, headers, activity_map={})["activity_map"] == {}
