"""Dashboard responses, retained badges, isolation, authentication and streaming."""

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import date, timedelta
from types import ModuleType
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from habitloop_shared.analytics import user_pk
from habitloop_shared.auth import encode_token
from habitloop_shared.config import get_settings


def log(updater: ModuleType, identity: dict[str, str], day: str, status: str = "completed",
        activity_id: str | None = None) -> None:
    updater.handler({**identity, "log_id": str(uuid4()), "activity_id": activity_id or str(uuid4()),
                     "status": status, "logged_at": f"{day}T07:00:00Z", "challenge_ids": []}, None)


def test_summary_trend_heatmap_cohorts_and_hours(
    client: TestClient, updater: ModuleType, identity: dict[str, str], headers: dict[str, str],
) -> None:
    for day, status in [("2026-11-17", "done"), ("2026-11-19", "completed"), ("2026-11-19", "missed")]:
        log(updater, identity, day, status)
    data = client.get("/api/analytics/summary", headers=headers).json()
    assert data == {"today": {"date": "2026-11-19", "done": 0, "completed": 1, "missed": 1},
                    "rate_7d": 2 / 3, "current_streak": 0, "best_streak": 1}
    for path in ("trend", "heatmap"):
        rows = client.get(f"/api/analytics/{path}?days=3", headers=headers).json()
        assert len(rows) == 3
        assert rows[1] == {"date": "2026-11-18", "done": 0, "completed": 0, "missed": 0}
        assert client.get(f"/api/analytics/{path}?days=0", headers=headers).status_code == 422
        assert client.get(f"/api/analytics/{path}?days=3661", headers=headers).status_code == 422
    assert len(client.get("/api/analytics/trend", headers=headers).json()) == 30
    assert len(client.get("/api/analytics/heatmap", headers=headers).json()) == 365
    assert client.get("/api/analytics/cohorts", headers=headers).json() == [
        {"week": "2026-11-16", "done": 1, "completed": 1, "missed": 1,
         "attempts": 3, "successes": 2, "rate": 2 / 3},
    ]
    path = f"/api/analytics/internal/users/{identity['user_id']}/hours"
    assert client.get(path, headers=headers).status_code == 401
    internal = {**headers, "X-Internal-Token": get_settings().internal_token.get_secret_value()}
    assert client.get(path, headers=internal).json() == [{"hour": "07", "attempts": 3, "successes": 2}]
    assert client.get(path, headers={"X-Internal-Token": internal["X-Internal-Token"]}).status_code == 401


def test_streak_waits_until_unlogged_day_ends(
    client: TestClient, updater: ModuleType, identity: dict[str, str], headers: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import routes

    log(updater, identity, "2026-11-18")
    assert client.get("/api/analytics/summary", headers=headers).json()["current_streak"] == 1
    monkeypatch.setattr(routes, "today", lambda: date(2026, 11, 20))
    data = client.get("/api/analytics/summary", headers=headers).json()
    assert data["current_streak"] == 0 and data["best_streak"] == 1


def test_milestones_remain_after_break_and_are_per_activity(
    client: TestClient, updater: ModuleType, identity: dict[str, str], headers: dict[str, str],
) -> None:
    activity_id = str(uuid4())
    for offset in range(7):
        log(updater, identity, (date(2026, 11, 12) + timedelta(days=offset)).isoformat(), activity_id=activity_id)
    expected = {"current_streak": 7, "best_streak": 7,
                "earned": [{"days": 7, "earned_date": "2026-11-18"}], "next": {"days": 30, "days_remaining": 23}}
    result = client.get("/api/analytics/milestones", headers=headers).json()
    assert result == {"overall": expected, "activities": [{"activity_id": activity_id, **expected}]}
    log(updater, identity, "2026-11-19", "missed", activity_id)
    result = client.get("/api/analytics/milestones", headers=headers).json()
    assert result["overall"]["earned"] == expected["earned"]
    assert result["activities"][0]["earned"] == expected["earned"]
    assert result["overall"]["current_streak"] == 0
    assert result["overall"]["next"] == {"days": 30, "days_remaining": 30}


def test_every_user_resource_is_tenant_isolated(
    client: TestClient, updater: ModuleType, identity: dict[str, str], headers: dict[str, str],
) -> None:
    log(updater, identity, "2026-11-19")
    outsider = {**identity, "tenant_id": str(uuid4())}
    outsider_headers = {"Authorization": "Bearer " + encode_token(**outsider, email="other@example.com", name="Other")}
    data = client.get("/api/analytics/summary", headers=outsider_headers).json()
    assert data["today"]["completed"] == 0 and data["best_streak"] == 0
    for path in ("trend", "heatmap"):
        rows = client.get(f"/api/analytics/{path}", headers=outsider_headers).json()
        assert all(row[status] == 0 for row in rows for status in ("done", "completed", "missed"))
    assert client.get("/api/analytics/cohorts", headers=outsider_headers).json() == []
    result = client.get("/api/analytics/milestones", headers=outsider_headers).json()
    assert result["overall"]["earned"] == [] and result["activities"] == []
    path = f"/api/analytics/internal/users/{identity['user_id']}/hours"
    assert client.get(path, headers={**outsider_headers, "X-Internal-Token": get_settings().internal_token.get_secret_value()}).json() == []
    for path in ("summary", "trend", "heatmap", "milestones", "cohorts", "stream"):
        assert client.get(f"/api/analytics/{path}").status_code == 401


def test_challenge_leaderboard_checks_visibility_and_partition(
    client: TestClient, table: Any, identity: dict[str, str], headers: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import routes
    from habitloop_shared.analytics import challenge_pk

    cid, other_uid, other_tenant = str(uuid4()), str(uuid4()), str(uuid4())
    for tid, uid, count in [(identity["tenant_id"], identity["user_id"], 2), (identity["tenant_id"], other_uid, 4),
                            (other_tenant, str(uuid4()), 99)]:
        table.put_item(Item={"PK": challenge_pk(tid, cid), "SK": f"PROGRESS#{uid}", "user_id": uid, "count": count})
    real_client = httpx.Client
    state = {"status": 200}

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == headers["Authorization"]
        return httpx.Response(state["status"], json={"target_count": 10})

    monkeypatch.setattr(routes.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    path = f"/api/analytics/challenges/{cid}/progress"
    result = client.get(path, headers=headers).json()
    assert result["target"] == 10
    assert [row["count"] for row in result["leaderboard"]] == [4, 2]
    state["status"] = 404
    assert client.get(path, headers=headers).status_code == 404
    state["status"] = 503
    assert client.get(path, headers=headers).status_code == 503


def test_stream_header_query_auth_and_tenant_isolation(
    client: TestClient, updater: ModuleType, identity: dict[str, str], headers: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import routes

    log(updater, identity, "2026-11-19")

    async def once(request: Any, table: Any, user: Any) -> AsyncIterator[str]:
        yield "event: summary\ndata: " + json.dumps(routes.summary_snapshot(table, user)[0]) + "\n\n"

    monkeypatch.setattr(routes, "summary_events", once)
    token = headers["Authorization"].removeprefix("Bearer ")
    for options in ({"headers": headers}, {"params": {"token": token}}):
        response = client.get("/api/analytics/stream", **options)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert '"completed": 1' in response.text
    assert client.get("/api/analytics/stream?token=bad").status_code == 401
    assert client.get("/api/analytics/stream", params={"token": token}, headers={"Authorization": "Bearer bad"}).status_code == 401
    other = encode_token(identity["user_id"], str(uuid4()), "other@example.com", "Other")
    response = client.get("/api/analytics/stream", params={"token": other})
    assert '"completed": 0' in response.text


def test_stream_polls_emits_changes_heartbeats_and_stops(
    table: Any, identity: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import routes

    state = {"polls": 0, "clock": 0.0, "revision": 0}
    sleeps: list[float] = []

    class Connection:
        async def is_disconnected(self) -> bool:
            state["polls"] += 1
            return state["polls"] > 7

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        state["clock"] += seconds
        if len(sleeps) == 2:
            state["revision"] += 1

    def snapshot(table: Any, user: Any) -> tuple[dict[str, Any], int]:
        assert user == identity
        return {"value": state["revision"]}, state["revision"]

    monkeypatch.setattr(routes.asyncio, "sleep", sleep)
    monkeypatch.setattr(routes.time, "monotonic", lambda: state["clock"])
    monkeypatch.setattr(routes, "summary_snapshot", snapshot)

    async def consume() -> list[str]:
        baseline = set(asyncio.all_tasks())
        events = [event async for event in routes.summary_events(Connection(), table, identity)]
        assert set(asyncio.all_tasks()) == baseline
        return events

    events = asyncio.run(consume())
    assert sum(event.startswith("event: summary") for event in events) == 2
    assert events.count(": heartbeat\n\n") == 1
    assert sleeps == [3.0] * 7


def test_stream_cancel_during_sleep_does_not_leak_tasks(
    table: Any, identity: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import routes

    class Connection:
        async def is_disconnected(self) -> bool:
            return False

    async def run() -> None:
        baseline = set(asyncio.all_tasks())
        sleeping = asyncio.Event()

        async def sleep(seconds: float) -> None:
            sleeping.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(routes.asyncio, "sleep", sleep)
        generator = routes.summary_events(Connection(), table, identity)
        assert (await anext(generator)).startswith("event: summary")
        pending = asyncio.create_task(anext(generator))
        await sleeping.wait()
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        await generator.aclose()
        assert set(asyncio.all_tasks()) == baseline

    asyncio.run(run())
