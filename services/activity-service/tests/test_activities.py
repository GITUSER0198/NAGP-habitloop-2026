"""Schedule validation, tenant isolation, occurrences and internal idempotency."""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from habitloop_shared import events
from habitloop_shared.auth import encode_token
from habitloop_shared.db import get_engine

PREFIX = "/api/activities"


def create(client: TestClient, headers: dict[str, str], **values: Any) -> dict[str, Any]:
    response = client.post(PREFIX, headers=headers, json={"name": "Run", "category": "fitness", **values})
    assert response.status_code == 201, response.text
    return response.json()


def test_crud_categories_and_soft_delete(
    client: TestClient, headers: dict[str, str], emitted: list[Any],
) -> None:
    from app.categories import load_categories

    assert client.get(f"{PREFIX}/categories", headers=headers).json() == load_categories()
    activity = create(client, headers)
    path = f"{PREFIX}/{activity['id']}"
    assert client.get(path, headers=headers).json() == activity
    assert client.get(PREFIX, headers=headers).json() == [activity]
    updated = client.patch(path, headers=headers, json={"name": "Evening run", "preferred_time": "21:30"})
    assert updated.status_code == 200
    assert updated.json()["preferred_time"] == "21:30"
    log = client.post(f"{path}/logs", headers=headers, json={"status": "done"})
    assert log.status_code == 201
    assert log.json()["source"] == "manual"
    assert log.json()["metadata"] == {}
    assert len(emitted) == 1
    assert client.delete(path, headers=headers).status_code == 204
    assert client.get(path, headers=headers).json()["active"] is False
    assert client.get(PREFIX, headers=headers).json() == []
    assert client.get(f"{path}/logs", headers=headers).json() == [log.json()]
    assert client.post(f"{path}/logs", headers=headers, json={"status": "done"}).status_code == 404
    assert client.patch(path, headers=headers, json={"name": "Again"}).status_code == 409


@pytest.mark.parametrize("changes", [
    {"preferred_time": "25:00"}, {"preferred_time": "09:60"}, {"preferred_time": "9:00"},
    {"category": "unknown"}, {"frequency": "weekly", "days_of_week": []},
    {"frequency": "custom", "days_of_week": []}, {"days_of_week": [-1]},
    {"days_of_week": [7]}, {"days_of_week": [True]}, {"target_per_week": 0},
    {"name": " "}, {"frequency": "monthly"},
])
def test_invalid_create(client: TestClient, headers: dict[str, str], changes: dict[str, Any]) -> None:
    response = client.post(PREFIX, headers=headers, json={"name": "Run", "category": "fitness", **changes})
    assert response.status_code == 422


def test_patch_validates_merged_schedule(client: TestClient, headers: dict[str, str]) -> None:
    activity = create(client, headers, frequency="weekly", days_of_week=[4, 1, 1])
    assert activity["days_of_week"] == [1, 4]
    path = f"{PREFIX}/{activity['id']}"
    for body in ({"days_of_week": []}, {"category": "bad"}, {"preferred_time": "25:00"}, {"name": None}):
        assert client.patch(path, headers=headers, json=body).status_code == 422
    assert client.get(path, headers=headers).json() == activity
    assert client.patch(path, headers=headers, json={"frequency": "daily", "days_of_week": []}).status_code == 200


def test_collection_trailing_slash_for_gateway(client: TestClient, headers: dict[str, str]) -> None:
    response = client.post(PREFIX + "/", headers=headers, json={"name": "Read", "category": "learning"})
    assert response.status_code == 201
    assert client.get(PREFIX + "/", headers=headers).json() == [response.json()]


def test_activity_and_log_tenant_isolation(
    client: TestClient, headers: dict[str, str], identity: dict[str, str], internal_headers: dict[str, str],
) -> None:
    activity = create(client, headers)
    path = f"{PREFIX}/{activity['id']}"
    assert client.post(f"{path}/logs", headers=headers, json={"status": "done"}).status_code == 201
    other_token = encode_token(uuid4(), uuid4(), "other@example.com", "Other")
    foreign = {"Authorization": f"Bearer {other_token}"}
    assert client.get(PREFIX, headers=foreign).json() == []
    assert client.get(f"{PREFIX}/today", headers=foreign).json() == []
    for method, suffix, body in (
        ("GET", "", None), ("PATCH", "", {"name": "Stolen"}), ("DELETE", "", None),
        ("GET", "/logs", None), ("POST", "/logs", {"status": "done"}),
    ):
        assert client.request(method, path + suffix, headers=foreign, json=body).status_code == 404
    internal_foreign = {**internal_headers, **foreign}
    response = client.get(
        f"{PREFIX}/internal/users/{identity['user_id']}/logs",
        params={"since": "2020-01-01T00:00:00Z"}, headers=internal_foreign,
    )
    assert response.status_code == 200
    assert response.json() == []
    assert client.patch(
        f"{PREFIX}/internal/{activity['id']}/schedule", headers=internal_foreign,
        json={"preferred_time": "10:00"},
    ).status_code == 404


def test_same_tenant_other_user_cannot_change_habits(
    client: TestClient, headers: dict[str, str], identity: dict[str, str],
) -> None:
    activity = create(client, headers)
    token = encode_token(uuid4(), identity["tenant_id"], "peer@example.com", "Peer")
    foreign = {"Authorization": f"Bearer {token}"}
    assert client.get(PREFIX, headers=foreign).json() == []
    assert client.post(f"{PREFIX}/{activity['id']}/logs", headers=foreign, json={"status": "done"}).status_code == 404


def test_partner_idempotency(
    client: TestClient, headers: dict[str, str], internal_headers: dict[str, str],
    identity: dict[str, str], emitted: list[Any], downstream: dict[str, Any],
) -> None:
    from app.models import ActivityLog

    activity = create(client, headers)
    challenge_id = str(uuid4())
    downstream["challenges"] = [challenge_id]
    body = {**identity, "activity_id": activity["id"], "status": "completed",
            "logged_at": "2026-11-19T09:00:00+05:30", "source": "partner",
            "source_event_id": str(uuid4()), "duration_min": 30, "metadata": {"steps": 4500}}
    first = client.post(f"{PREFIX}/internal/logs", headers=internal_headers, json=body)
    assert first.status_code == 201, first.text
    assert first.json()["metadata"] == {"steps": 4500}
    second = client.post(f"{PREFIX}/internal/logs", headers=internal_headers, json=body)
    assert second.status_code == 200
    assert second.json() == {"duplicate": True}
    with Session(get_engine()) as db:
        assert db.scalar(select(func.count()).select_from(ActivityLog)) == 1
    assert len(emitted) == 1
    kind, detail = emitted[0]
    assert kind == "ActivityLogged"
    assert detail == {**identity, "activity_id": activity["id"], "log_id": first.json()["id"],
                      "status": "completed", "logged_at": "2026-11-19T03:30:00+00:00",
                      "source": "partner", "challenge_ids": [challenge_id]}
    outgoing = downstream["requests"][-1]
    assert outgoing.url.params["category"] == "fitness"
    assert outgoing.headers["X-Internal-Token"] == internal_headers["X-Internal-Token"]
    assert outgoing.headers["Authorization"] == headers["Authorization"]
    # A retry after soft deletion is still the same event.
    assert client.delete(f"{PREFIX}/{activity['id']}", headers=headers).status_code == 204
    assert client.post(f"{PREFIX}/internal/logs", headers=internal_headers, json=body).status_code == 200


def test_partner_tenant_and_user_isolation(
    client: TestClient, headers: dict[str, str], identity: dict[str, str], internal_headers: dict[str, str],
) -> None:
    activity = create(client, headers)
    body = {**identity, "activity_id": activity["id"], "status": "done", "logged_at": "2026-11-19T00:00:00Z",
            "source": "partner", "source_event_id": str(uuid4()), "duration_min": None, "metadata": {}}
    for changed in ({"tenant_id": str(uuid4())}, {"user_id": str(uuid4())}):
        assert client.post(f"{PREFIX}/internal/logs", headers=internal_headers, json={**body, **changed}).status_code == 404
    secret_only = {"X-Internal-Token": internal_headers["X-Internal-Token"]}
    assert client.post(f"{PREFIX}/internal/logs", headers=secret_only, json=body).status_code == 201


def test_partner_conflicting_event_does_not_publish(
    client: TestClient, headers: dict[str, str], identity: dict[str, str],
    internal_headers: dict[str, str], emitted: list[Any],
) -> None:
    first = create(client, headers)
    second = create(client, headers)
    body = {**identity, "activity_id": first["id"], "status": "done", "logged_at": "2026-11-19T00:00:00Z",
            "source": "partner", "source_event_id": str(uuid4()), "metadata": {}}
    assert client.post(f"{PREFIX}/internal/logs", headers=internal_headers, json=body).status_code == 201
    assert client.post(f"{PREFIX}/internal/logs", headers=internal_headers,
                       json={**body, "activity_id": second["id"]}).status_code == 409
    assert len(emitted) == 1


@pytest.mark.parametrize("challenge_status,payload", [(503, []), (200, {}), (200, ["not-a-uuid"])])
def test_challenge_failure_keeps_log(
    client: TestClient, headers: dict[str, str], emitted: list[Any], downstream: dict[str, Any],
    challenge_status: int, payload: Any,
) -> None:
    downstream["challenge_status"] = challenge_status
    downstream["challenges"] = payload
    activity = create(client, headers)
    response = client.post(f"{PREFIX}/{activity['id']}/logs", headers=headers, json={"status": "missed"})
    assert response.status_code == 201
    assert emitted[0][1]["challenge_ids"] == []
    assert len(client.get(f"{PREFIX}/{activity['id']}/logs", headers=headers).json()) == 1


def test_log_filters_and_internal_schedule(
    client: TestClient, headers: dict[str, str], internal_headers: dict[str, str], identity: dict[str, str],
) -> None:
    activity = create(client, headers, frequency="weekly", days_of_week=[0, 3])
    path = f"{PREFIX}/{activity['id']}/logs"
    for status, timestamp in (("done", "2026-11-18T10:00:00Z"), ("completed", "2026-11-19T23:59:59Z"),
                              ("missed", "2026-11-20T00:00:00Z")):
        assert client.post(path, headers=headers, json={"status": status, "logged_at": timestamp}).status_code == 201
    response = client.get(path, headers=headers, params={"from": "2026-11-19", "to": "2026-11-19"})
    assert [entry["status"] for entry in response.json()] == ["completed"]
    assert client.get(path, headers=headers, params={"from": "2026-11-19T12:00:00Z", "to": "2026-11-19"}).status_code == 200
    assert client.get(path, headers=headers, params={"from": "invalid"}).status_code == 422
    assert client.get(path, headers=headers, params={"from": "2026-11-20", "to": "2026-11-19"}).status_code == 422
    internal = client.get(f"{PREFIX}/internal/users/{identity['user_id']}/logs", headers=internal_headers,
                          params={"since": "2026-11-19T00:00:00Z"})
    assert [entry["status"] for entry in internal.json()] == ["completed", "missed"]
    schedule = f"{PREFIX}/internal/{activity['id']}/schedule"
    response = client.patch(schedule, headers=internal_headers,
                            json={"preferred_time": "21:00", "days_of_week": [2], "target_per_week": 3})
    assert response.status_code == 200
    assert response.json()["target_per_week"] == 3
    for body in ({"days_of_week": []}, {"preferred_time": "25:00"}, {"target_per_week": None}, {"name": "No"}):
        assert client.patch(schedule, headers=internal_headers, json=body).status_code == 422
    assert client.delete(f"{PREFIX}/{activity['id']}", headers=headers).status_code == 204
    assert client.patch(schedule, headers=internal_headers, json={"preferred_time": "10:00"}).status_code == 409


def test_today_uses_user_timezone_and_local_day_logs(
    client: TestClient, headers: dict[str, str], downstream: dict[str, Any],
) -> None:
    zone = ZoneInfo("Pacific/Kiritimati")
    downstream["timezone"] = zone.key
    local_date = datetime.now(zone).date()
    daily = create(client, headers, preferred_time="07:15")
    weekly = create(client, headers, frequency="weekly", days_of_week=[local_date.weekday()])
    create(client, headers, frequency="custom", days_of_week=[(local_date.weekday() + 1) % 7])
    removed = create(client, headers)
    client.delete(f"{PREFIX}/{removed['id']}", headers=headers)
    today_utc = datetime(local_date.year, local_date.month, local_date.day, 0, 30, tzinfo=zone).astimezone(timezone.utc)
    for timestamp, status in ((today_utc - timedelta(days=1), "missed"), (today_utc, "done"),
                              (today_utc + timedelta(hours=1), "completed")):
        client.post(f"{PREFIX}/{daily['id']}/logs", headers=headers,
                    json={"status": status, "logged_at": timestamp.isoformat()})
    result = client.get(f"{PREFIX}/today", headers=headers)
    assert result.status_code == 200, result.text
    items = {item["id"]: item for item in result.json()}
    assert set(items) == {daily["id"], weekly["id"]}
    assert items[daily["id"]]["status"] == "completed"
    assert items[weekly["id"]]["status"] is None
    assert items[daily["id"]]["due_at"] == f"{local_date.isoformat()}T07:15:00+14:00"
    assert downstream["requests"][-1].headers["Authorization"] == headers["Authorization"]


def test_today_timezone_unavailable(client: TestClient, headers: dict[str, str], downstream: dict[str, Any]) -> None:
    downstream["timezone"] = "Invalid/Zone"
    assert client.get(f"{PREFIX}/today", headers=headers).status_code == 503


@pytest.mark.parametrize("body", [{"status": "invalid"}, {"status": "done", "duration_min": -1},
                                      {"status": "done", "logged_at": "2026-11-19T09:00:00"}])
def test_invalid_log(client: TestClient, headers: dict[str, str], body: dict[str, Any]) -> None:
    activity = create(client, headers)
    assert client.post(f"{PREFIX}/{activity['id']}/logs", headers=headers, json=body).status_code == 422


def test_internal_authentication(client: TestClient, headers: dict[str, str], internal_headers: dict[str, str]) -> None:
    activity = create(client, headers)
    schedule = f"{PREFIX}/internal/{activity['id']}/schedule"
    assert client.patch(schedule, headers=headers, json={}).status_code == 401
    assert client.patch(schedule, headers={"X-Internal-Token": internal_headers["X-Internal-Token"]}, json={}).status_code == 401
    assert client.post(f"{PREFIX}/internal/logs", json={}).status_code == 401
    assert client.get(PREFIX).status_code == 401


def test_publication_failure_rolls_back(
    client: TestClient, headers: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    activity = create(client, headers)
    path = f"{PREFIX}/{activity['id']}/logs"

    def failed_publish(kind: str, detail: dict[str, Any]) -> None:
        raise httpx.ConnectError("Unavailable")

    monkeypatch.setattr(events, "publish", failed_publish)
    assert client.post(path, headers=headers, json={"status": "done"}).status_code == 502
    assert client.get(path, headers=headers).json() == []
