"""Local and SQS normalization, rejections, retry identities and partial failure."""

import copy
import importlib.util
import json
import os
import secrets
from pathlib import Path
from types import ModuleType
from typing import Any
from uuid import uuid4

import jwt
import pytest
import requests


@pytest.fixture
def normalizer(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.setenv("JWT_SECRET", secrets.token_urlsafe(64))
    monkeypatch.setenv("INTERNAL_TOKEN", secrets.token_urlsafe(32))
    monkeypatch.setenv("INTEGRATION_SERVICE_URL", "http://integration-service:47820")
    monkeypatch.setenv("ACTIVITY_SERVICE_URL", "http://activity-service:47820")
    path = Path(__file__).resolve().parents[1] / "handler.py"
    spec = importlib.util.spec_from_file_location("tested_normalizer", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def detail() -> dict[str, Any]:
    return {
        "tenant_id": str(uuid4()), "user_id": str(uuid4()), "link_id": str(uuid4()),
        "partner_event_id": str(uuid4()), "provider": "mockfit", "raw": {
            "event_id": str(uuid4()), "type": "workout", "provider_activity": "run",
            "duration_min": 25, "started_at": "2026-11-19T09:00:00+05:30",
        },
    }


@pytest.fixture
def downstream(monkeypatch: pytest.MonkeyPatch, detail: dict[str, Any]) -> dict[str, Any]:
    state: dict[str, Any] = {
        "activity_id": str(uuid4()), "log_status": 201, "patch_status": 200, "get_status": 200,
        "logs": {}, "posts": [], "patches": [], "gets": [],
    }
    state["links"] = [{
        "id": detail["link_id"], "tenant_id": detail["tenant_id"], "user_id": detail["user_id"],
        "provider": "mockfit", "status": "active", "activity_map": {"run": state["activity_id"]},
    }]

    def response(status: int, body: Any) -> requests.Response:
        result = requests.Response()
        result.status_code = status
        result._content = json.dumps(body).encode("utf-8")
        return result

    def get(url: str, **kwargs: Any) -> requests.Response:
        state["gets"].append((url, kwargs))
        return response(state["get_status"], state["links"])

    def post(url: str, **kwargs: Any) -> requests.Response:
        state["posts"].append((url, kwargs))
        body = kwargs["json"]
        if state["log_status"] >= 400:
            return response(state["log_status"], {})
        duplicate = body["source_event_id"] in state["logs"]
        state["logs"].setdefault(body["source_event_id"], body)
        return response(200 if duplicate else state["log_status"], {"duplicate": duplicate})

    def patch(url: str, **kwargs: Any) -> requests.Response:
        state["patches"].append((url, kwargs))
        return response(state["patch_status"], kwargs["json"])

    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(requests, "patch", patch)
    return state


@pytest.mark.parametrize("duration,steps,status", [
    (0, None, "done"), (19, 4999, "done"), (20, 0, "completed"), (0, 5000, "completed"),
    (25, 6000, "completed"),
])
def test_local_mapping_thresholds_and_status(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any],
    duration: int, steps: int | None, status: str,
) -> None:
    detail["raw"].update(duration_min=duration, steps=steps)
    assert normalizer.handler(detail, None) == {"batchItemFailures": []}
    url, options = downstream["posts"][0]
    assert url.endswith("/api/activities/internal/logs")
    body = options["json"]
    assert body["activity_id"] == downstream["activity_id"]
    assert body["tenant_id"] == detail["tenant_id"] and body["user_id"] == detail["user_id"]
    assert body["status"] == status and body["source"] == "partner"
    assert body["logged_at"] == detail["raw"]["started_at"]
    assert body["duration_min"] == duration
    assert body["source_event_id"] == detail["partner_event_id"]
    assert body["metadata"]["event_id"] == detail["raw"]["event_id"]
    assert downstream["patches"][-1][0].endswith(f"/api/integrations/internal/events/{detail['partner_event_id']}")
    assert downstream["patches"][-1][1]["json"] == {"status": "normalized"}
    assert options["headers"]["X-Internal-Token"] == os.environ["INTERNAL_TOKEN"]
    claims = jwt.decode(
        options["headers"]["Authorization"].removeprefix("Bearer "),
        os.environ["JWT_SECRET"], algorithms=["HS256"],
    )
    assert claims["tenant_id"] == detail["tenant_id"] and claims["sub"] == detail["user_id"]
    assert claims["exp"] - claims["iat"] == 3600


def test_unmapped_activity_rejected_with_visible_reason(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any],
) -> None:
    detail["raw"]["provider_activity"] = "swim"
    assert normalizer.handler(detail, None) == {"batchItemFailures": []}
    assert downstream["posts"] == []
    assert downstream["patches"][-1][1]["json"] == {
        "status": "rejected", "reason": "Unmapped provider activity: swim",
    }


@pytest.mark.parametrize("raw", [
    None, {}, {"type": "sleep"}, {"duration_min": -1}, {"duration_min": True},
    {"steps": -1}, {"steps": True}, {"started_at": "bad"},
    {"started_at": "2026-11-19T09:00:00"}, {"event_id": ""}, {"provider_activity": None},
])
def test_invalid_workout_is_terminal_rejection(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any], raw: Any,
) -> None:
    if raw is None or raw == {} or raw.get("type") == "sleep":
        detail["raw"] = raw
    else:
        detail["raw"].update(raw)
    normalizer.handler(detail, None)
    assert downstream["posts"] == [] and downstream["gets"] == []
    assert downstream["patches"][-1][1]["json"]["status"] == "rejected"
    assert downstream["patches"][-1][1]["json"]["reason"]


@pytest.mark.parametrize("changed", ["missing", "deleted", "provider", "tenant_id", "user_id", "mapping"])
def test_missing_deleted_or_mismatched_link_rejected(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any], changed: str,
) -> None:
    if changed == "missing":
        downstream["links"] = []
    elif changed == "deleted":
        downstream["links"][0]["status"] = "deleted"
    elif changed == "mapping":
        downstream["links"][0]["activity_map"]["run"] = "bad"
    else:
        downstream["links"][0][changed] = "mockrun" if changed == "provider" else str(uuid4())
    normalizer.handler(detail, None)
    assert downstream["posts"] == []
    assert downstream["patches"][-1][1]["json"]["status"] == "rejected"


@pytest.mark.parametrize("status", [404, 409, 422])
def test_permanent_activity_error_is_rejected(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any], status: int,
) -> None:
    downstream["log_status"] = status
    normalizer.handler(detail, None)
    assert downstream["patches"][-1][1]["json"] == {
        "status": "rejected", "reason": f"Activity log rejected (HTTP {status})",
    }


def test_retry_after_log_creation_preserves_single_source_identity(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any],
) -> None:
    downstream["patch_status"] = 503
    with pytest.raises(requests.HTTPError):
        normalizer.handler(detail, None)
    assert len(downstream["logs"]) == 1
    downstream["patch_status"] = 200
    assert normalizer.handler(detail, None) == {"batchItemFailures": []}
    assert len(downstream["logs"]) == 1
    assert len(downstream["posts"]) == 2
    assert downstream["posts"][0][1]["json"] == downstream["posts"][1][1]["json"]


def test_sqs_partial_failures_continue_other_messages(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any],
) -> None:
    unmapped = copy.deepcopy(detail)
    unmapped["partner_event_id"] = str(uuid4())
    unmapped["raw"]["provider_activity"] = "yoga"
    missing_identity = copy.deepcopy(detail)
    del missing_identity["tenant_id"]
    records = [
        {"messageId": "good", "body": json.dumps({"detail-type": "PartnerEventReceived", "detail": detail})},
        {"messageId": "bad-json", "body": "{"},
        {"messageId": "unmapped", "body": json.dumps({"detail-type": "PartnerEventReceived", "detail": unmapped})},
        {"messageId": "bad-identity", "body": json.dumps(missing_identity)},
        {"messageId": "last-good", "body": json.dumps(detail)},
    ]
    assert normalizer.handler({"Records": records}, None) == {"batchItemFailures": [
        {"itemIdentifier": "bad-json"}, {"itemIdentifier": "bad-identity"},
    ]}
    assert len(downstream["logs"]) == 1
    assert len(downstream["posts"]) == 2
    assert len(downstream["patches"]) == 3


@pytest.mark.parametrize("failure_at", ["get_status", "log_status", "patch_status"])
def test_transient_sqs_failures_are_reported_for_retry(
    normalizer: ModuleType, detail: dict[str, Any], downstream: dict[str, Any], failure_at: str,
) -> None:
    downstream[failure_at] = 503
    event = {"Records": [{"messageId": "retry-me", "body": json.dumps({
        "detail-type": "PartnerEventReceived", "detail": detail,
    })}]}
    assert normalizer.handler(event, None) == {"batchItemFailures": [{"itemIdentifier": "retry-me"}]}
    if failure_at != "patch_status":
        assert downstream["patches"] == []


def test_empty_sqs_batch(normalizer: ModuleType) -> None:
    assert normalizer.handler({"Records": []}, None) == {"batchItemFailures": []}
