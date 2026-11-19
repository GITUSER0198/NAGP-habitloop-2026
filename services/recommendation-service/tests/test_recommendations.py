"""Rule boundaries, service calls, retry behavior and tenant isolation."""

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from habitloop_shared.auth import encode_token
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_engine

PREFIX = "/api/recommendations"
NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)


def timing(state: dict[str, Any]) -> None:
    state["hours"] = [
        {"hour": "07", "attempts": 11, "successes": 9},
        {"hour": "20", "attempts": 10, "successes": 4},
        {"hour": "06", "attempts": 2, "successes": 2},
    ]


def log(state: dict[str, Any], status: str, days_ago: float = 1) -> dict[str, Any]:
    activity = state["activities"][0]
    return {
        "tenant_id": activity["tenant_id"], "user_id": activity["user_id"],
        "activity_id": activity["id"], "status": status,
        "logged_at": (NOW - timedelta(days=days_ago)).isoformat(),
    }


def refresh(client: TestClient, headers: dict[str, str]) -> list[dict[str, Any]]:
    response = client.post(f"{PREFIX}/refresh", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["recommendations"]


def test_timing_uses_best_eligible_window_and_formats_reason(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], identity: dict[str, str],
) -> None:
    timing(downstream)
    rows = refresh(client, headers)
    assert len(rows) == 1
    row = rows[0]
    assert row["kind"] == "timing"
    assert row["current_value"] == {"preferred_time": "20:30"}
    assert row["suggested_value"] == {"preferred_time": "07:00"}
    assert row["confidence"] == "medium"
    assert row["reason"] == "You complete Running 82% of the time around 7:00 AM vs 40% around 8:00 PM"
    assert row["tenant_id"] == identity["tenant_id"]
    assert row["user_id"] == identity["user_id"]
    assert row["created_at"].endswith("Z")
    listed = client.get(PREFIX, headers=headers, params={"status": "pending"})
    assert listed.json() == {"recommendations": rows}
    requests = downstream["requests"]
    assert len(requests) == 3
    assert requests[1].url.path == f"/api/analytics/internal/users/{identity['user_id']}/hours"
    assert requests[2].url.path == f"/api/activities/internal/users/{identity['user_id']}/logs"
    assert datetime.fromisoformat(requests[2].url.params["since"]) == NOW - timedelta(days=14)
    for request in requests:
        assert request.headers["Authorization"] == headers["Authorization"]
        assert request.headers["X-Internal-Token"] == get_settings().internal_token.get_secret_value()


@pytest.mark.parametrize("best_successes,expected", [(12, False), (13, True), (14, True)])
def test_fifteen_percentage_point_boundary(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
    best_successes: int, expected: bool,
) -> None:
    downstream["hours"] = [
        {"hour": 7, "attempts": 20, "successes": best_successes},
        {"hour": 20, "attempts": 20, "successes": 10},
    ]
    assert bool(refresh(client, headers)) == expected


@pytest.mark.parametrize("hours", [
    [],
    [{"hour": 7, "attempts": 2, "successes": 2}, {"hour": 20, "attempts": 2, "successes": 0}],
    [{"hour": 7, "attempts": 3, "successes": 3}],
    [{"hour": 7, "attempts": 3, "successes": 3}, {"hour": 20, "attempts": 2, "successes": 0}],
])
def test_insufficient_data_has_no_suggestions_and_explains_why(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], hours: list[dict[str, int]],
) -> None:
    downstream["hours"] = hours
    downstream["logs"] = [log(downstream, "missed") for _ in range(2)]
    expected = {"recommendations": [], "reason": "needs at least 3 logs per time window"}
    assert client.post(f"{PREFIX}/refresh", headers=headers).json() == expected
    assert client.get(PREFIX, headers=headers).json() == expected


def test_enough_data_without_improvement_has_no_misleading_reason(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    downstream["hours"] = [
        {"hour": 7, "attempts": 3, "successes": 3},
        {"hour": 20, "attempts": 3, "successes": 3},
    ]
    assert refresh(client, headers) == []
    assert client.get(PREFIX, headers=headers).json() == {"recommendations": []}


@pytest.mark.parametrize("attempts,confidence", [(3, "low"), (9, "low"), (10, "medium"),
                                                    (29, "medium"), (30, "high")])
def test_timing_confidence_uses_smaller_window_sample(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
    attempts: int, confidence: str,
) -> None:
    downstream["hours"] = [
        {"hour": 7, "attempts": 40, "successes": 40},
        {"hour": 20, "attempts": attempts, "successes": 0},
    ]
    assert refresh(client, headers)[0]["confidence"] == confidence


def test_tied_windows_choose_most_evidence_then_earliest_hour(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    downstream["hours"] = [
        {"hour": 9, "attempts": 4, "successes": 4},
        {"hour": 8, "attempts": 5, "successes": 5},
        {"hour": 7, "attempts": 5, "successes": 5},
        {"hour": 20, "attempts": 3, "successes": 0},
    ]
    assert refresh(client, headers)[0]["suggested_value"] == {"preferred_time": "07:00"}


@pytest.mark.parametrize("completed,expected", [(0, True), (6, True), (7, False), (14, False)])
def test_daily_frequency_rule_and_fifty_percent_boundary(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], completed: int, expected: bool,
) -> None:
    downstream["logs"] = [log(downstream, "completed" if day < completed else "missed", day + 0.5)
                          for day in range(14)]
    rows = refresh(client, headers)
    assert bool(rows) == expected
    if expected:
        assert rows[0]["kind"] == "frequency"
        assert rows[0]["current_value"] == {"target_per_week": 7}
        assert rows[0]["suggested_value"] == {"target_per_week": 3}
        assert rows[0]["confidence"] == "medium"
        assert f"{completed} of the last 14 daily targets" in rows[0]["reason"]


def test_frequency_uses_current_activity_full_completions_and_window_bounds(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    # Partial completions are attempts, but do not meet a full daily target.
    downstream["logs"] = [log(downstream, "done", day) for day in range(1, 7)]
    downstream["logs"] += [log(downstream, "completed", 14.01), log(downstream, "completed", -1)]
    downstream["logs"] += [{**log(downstream, "completed"), "activity_id": str(uuid4())} for _ in range(14)]
    downstream["logs"] += [{**log(downstream, "completed"), "tenant_id": str(uuid4())} for _ in range(14)]
    downstream["logs"] += [{**log(downstream, "completed"), "user_id": str(uuid4())} for _ in range(14)]
    row = refresh(client, headers)[0]
    assert "0 of the last 14 daily targets" in row["reason"]
    assert row["suggested_value"] == {"target_per_week": 3}
    assert row["confidence"] == "low"


@pytest.mark.parametrize("frequency,target", [("weekly", 7), ("custom", 7), ("daily", 3), ("daily", 2)])
def test_frequency_only_reduces_daily_targets(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], frequency: str, target: int,
) -> None:
    downstream["activities"][0].update(frequency=frequency, target_per_week=target)
    downstream["logs"] = [log(downstream, "missed") for _ in range(14)]
    assert refresh(client, headers) == []


def test_both_rules_dedupe_by_values_and_activity(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    timing(downstream)
    downstream["logs"] = [log(downstream, "missed", day) for day in range(1, 4)]
    downstream["activities"].append({**downstream["activities"][0], "id": str(uuid4()), "name": "Reading"})
    first = refresh(client, headers)
    assert len(first) == 3
    assert sorted(row["kind"] for row in first) == ["frequency", "timing", "timing"]
    assert {row["id"] for row in refresh(client, headers)} == {row["id"] for row in first}
    downstream["activities"][0]["preferred_time"] = "20:45"
    assert len(refresh(client, headers)) == 4


def test_database_prevents_duplicate_pending_values(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    from app.models import Recommendation

    timing(downstream)
    row = refresh(client, headers)[0]
    with Session(get_engine()) as db:
        db.add(Recommendation(
            tenant_id=UUID(row["tenant_id"]), user_id=UUID(row["user_id"]),
            activity_id=UUID(row["activity_id"]), kind=row["kind"],
            current_value=row["current_value"], suggested_value=row["suggested_value"],
            reason=row["reason"], confidence=row["confidence"],
        ))
        with pytest.raises(IntegrityError):
            db.commit()


@pytest.mark.parametrize("kind", ["timing", "frequency"])
def test_accept_patches_schedule_then_publishes_once_and_is_idempotent(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
    identity: dict[str, str], kind: str,
) -> None:
    if kind == "timing":
        timing(downstream)
    else:
        downstream["logs"] = [log(downstream, "missed") for _ in range(3)]
    row = refresh(client, headers)[0]
    path = f"{PREFIX}/{row['id']}/accept"
    accepted = client.post(path, headers=headers)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    assert client.post(path, headers=headers).json() == accepted.json()
    assert downstream["effects"] == [
        ("patch", row["suggested_value"]),
        ("RecommendationAccepted", {**identity, "recommendation_id": row["id"], "activity_id": row["activity_id"]}),
    ]
    patch = [request for request in downstream["requests"] if request.method == "PATCH"]
    assert len(patch) == 1
    assert patch[0].url.path == f"/api/activities/internal/{row['activity_id']}/schedule"
    assert patch[0].headers["Authorization"] == headers["Authorization"]
    assert patch[0].headers["X-Internal-Token"] == get_settings().internal_token.get_secret_value()
    assert json.loads(patch[0].content) == row["suggested_value"]
    assert client.get(PREFIX, headers=headers, params={"status": "accepted"}).json()["recommendations"][0] == accepted.json()
    assert client.post(f"{PREFIX}/{row['id']}/dismiss", headers=headers).status_code == 409


@pytest.mark.parametrize("activity_status", [404, 409])
def test_deleted_activity_dismisses_recommendation_and_returns_conflict(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], activity_status: int,
) -> None:
    timing(downstream)
    row = refresh(client, headers)[0]
    downstream["patch_status"] = activity_status
    path = f"{PREFIX}/{row['id']}/accept"
    assert client.post(path, headers=headers).status_code == 409
    assert client.post(path, headers=headers).status_code == 409
    assert len(downstream["effects"]) == 1
    dismissed = client.get(PREFIX, headers=headers, params={"status": "dismissed"}).json()["recommendations"]
    assert dismissed[0]["status"] == "dismissed"
    assert dismissed[0]["id"] == row["id"]


def test_dismiss_is_idempotent_and_allows_new_pending_values(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    timing(downstream)
    row = refresh(client, headers)[0]
    path = f"{PREFIX}/{row['id']}/dismiss"
    dismissed = client.post(path, headers=headers)
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"
    assert client.post(path, headers=headers).json() == dismissed.json()
    assert client.post(f"{PREFIX}/{row['id']}/accept", headers=headers).status_code == 409
    assert downstream["effects"] == []
    assert refresh(client, headers)[0]["id"] != row["id"]


@pytest.mark.parametrize("other_tenant", [True, False])
def test_tenant_and_user_isolation_for_list_refresh_accept_and_dismiss(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
    identity: dict[str, str], other_tenant: bool,
) -> None:
    timing(downstream)
    row = refresh(client, headers)[0]
    foreign = {**identity}
    foreign["tenant_id" if other_tenant else "user_id"] = str(uuid4())
    foreign_headers = {"Authorization": "Bearer " + encode_token(**foreign, email="other@example.com", name="Other")}
    assert client.get(PREFIX, headers=foreign_headers).json() == {"recommendations": []}
    assert refresh(client, foreign_headers) == []
    for action in ("accept", "dismiss"):
        assert client.post(f"{PREFIX}/{row['id']}/{action}", headers=foreign_headers).status_code == 404
    assert downstream["effects"] == []
    assert client.get(PREFIX, headers=headers).json()["recommendations"][0]["status"] == "pending"


def test_inactive_and_foreign_activities_are_ignored(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str],
) -> None:
    timing(downstream)
    original = downstream["activities"][0]
    downstream["activities"] = [
        {**original, "active": False},
        {**original, "id": str(uuid4()), "tenant_id": str(uuid4())},
        {**original, "id": str(uuid4()), "user_id": str(uuid4())},
    ]
    assert refresh(client, headers) == []
    assert len(downstream["requests"]) == 1


@pytest.mark.parametrize("failure", ["history_status", "transport_error"])
def test_history_failure_is_retryable_and_does_not_create_suggestions(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], failure: str,
) -> None:
    timing(downstream)
    downstream[failure] = 503 if failure == "history_status" else True
    assert client.post(f"{PREFIX}/refresh", headers=headers).status_code == 503
    assert client.get(PREFIX, headers=headers).status_code == 503
    downstream[failure] = 200 if failure == "history_status" else False
    assert len(refresh(client, headers)) == 1


@pytest.mark.parametrize("failure", ["patch", "event", "transport"])
def test_failed_accept_remains_pending_and_can_be_retried(
    client: TestClient, downstream: dict[str, Any], headers: dict[str, str], failure: str,
) -> None:
    timing(downstream)
    row = refresh(client, headers)[0]
    downstream["patch_status"] = 503 if failure == "patch" else 200
    downstream["event_error"] = failure == "event"
    downstream["transport_error"] = failure == "transport"
    path = f"{PREFIX}/{row['id']}/accept"
    assert client.post(path, headers=headers).status_code == 502
    assert client.get(PREFIX, headers=headers).json()["recommendations"][0]["status"] == "pending"
    assert not any(effect[0] == "RecommendationAccepted" for effect in downstream["effects"])
    downstream.update(patch_status=200, event_error=False, transport_error=False)
    assert client.post(path, headers=headers).json()["status"] == "accepted"
    assert len([effect for effect in downstream["effects"] if effect[0] == "RecommendationAccepted"]) == 1


def test_authentication_status_validation_and_unknown_ids(
    client: TestClient, headers: dict[str, str],
) -> None:
    for method, path in (("GET", PREFIX), ("POST", f"{PREFIX}/refresh"),
                         ("POST", f"{PREFIX}/{uuid4()}/accept"), ("POST", f"{PREFIX}/{uuid4()}/dismiss")):
        assert client.request(method, path).status_code == 401
    assert client.get(PREFIX, headers=headers, params={"status": "unknown"}).status_code == 422
    for action in ("accept", "dismiss"):
        assert client.post(f"{PREFIX}/{uuid4()}/{action}", headers=headers).status_code == 404
        assert client.post(f"{PREFIX}/invalid/{action}", headers=headers).status_code == 422
