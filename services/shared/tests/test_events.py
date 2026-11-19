"""Verify local HTTP envelopes against the worker and EventBridge behavior."""

import json
import runpy
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from habitloop_shared import events
from habitloop_shared.config import get_settings
from habitloop_shared.logging import configure_logging


def test_local_publish_posts_to_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    worker_path = Path(__file__).resolve().parents[3] / "tools" / "event-worker" / "app" / "main.py"
    worker = runpy.run_path(str(worker_path))
    handled: list[dict[str, object]] = []

    async def handler(detail: dict[str, object]) -> None:
        handled.append(detail)

    monkeypatch.setitem(worker["handlers"], "ActivityLogged", [handler])
    configure_logging("activity-service", "INFO")
    detail = {"tenant_id": str(uuid4()), "user_id": str(uuid4()), "log_id": str(uuid4())}
    received: list[httpx.Request] = []
    original_client = httpx.Client
    with TestClient(worker["app"]) as worker_client:
        def dispatch(request: httpx.Request) -> httpx.Response:
            received.append(request)
            assert str(request.url) == get_settings().event_worker_url
            return worker_client.post("/events", content=request.content, headers=dict(request.headers))

        transport = httpx.MockTransport(dispatch)
        monkeypatch.setattr(events.httpx, "Client", lambda **kwargs: original_client(transport=transport, **kwargs))
        events.publish("ActivityLogged", detail)
        assert handled == [detail]
        assert json.loads(received[0].content) == {
            "source": "habitloop.activity", "detail-type": "ActivityLogged", "detail": detail,
        }
        assert worker_client.post("/events", json={"detail-type": "ActivityLogged", "detail": {}}).status_code == 401
        assert worker_client.post("/events", json={"detail-type": "OtherEvent", "detail": {}}, headers={
            "X-Internal-Token": get_settings().internal_token.get_secret_value(),
        }).status_code == 202


def test_local_publish_propagates_http_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    original_client = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    monkeypatch.setattr(events.httpx, "Client", lambda **kwargs: original_client(transport=transport, **kwargs))
    with pytest.raises(httpx.HTTPStatusError):
        events.publish("ActivityLogged", {})


@pytest.mark.parametrize("failed_count", [0, 1])
def test_aws_publish(monkeypatch: pytest.MonkeyPatch, failed_count: int) -> None:
    monkeypatch.setenv("EVENT_BUS_MODE", "aws")
    monkeypatch.setenv("EVENT_BUS_NAME", "habitloop-test")
    get_settings.cache_clear()
    configure_logging("activity-service", "INFO")
    client = MagicMock()
    client.put_events.return_value = {"FailedEntryCount": failed_count}
    factory = MagicMock(return_value=client)
    monkeypatch.setattr(events.boto3, "client", factory)
    if failed_count:
        with pytest.raises(RuntimeError, match="EventBridge failed"):
            events.publish("ActivityLogged", {"tenant_id": "tenant"})
    else:
        events.publish("ActivityLogged", {"tenant_id": "tenant"})
    factory.assert_called_once_with("events", region_name=get_settings().aws_region)
    entry = client.put_events.call_args.kwargs["Entries"][0]
    assert entry["EventBusName"] == "habitloop-test"
    assert entry["Source"] == "habitloop.activity"
    assert entry["DetailType"] == "ActivityLogged"
    assert json.loads(entry["Detail"]) == {"tenant_id": "tenant"}
