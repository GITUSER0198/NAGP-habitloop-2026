"""Exactly-once aggregation, calendar boundaries, badges and retry recovery."""

import importlib.util
import json
import secrets
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from types import ModuleType
from typing import Any
from uuid import uuid4

import boto3
import httpx
import jwt
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from habitloop_shared.analytics import analytics_table, challenge_pk, query_items, user_pk
from habitloop_shared.config import get_settings


@pytest.fixture
def updater(monkeypatch: pytest.MonkeyPatch) -> Iterator[ModuleType]:
    for name, value in {
        "JWT_SECRET": secrets.token_urlsafe(64), "INTERNAL_TOKEN": secrets.token_urlsafe(32),
        "DATABASE_URL": "sqlite+pysqlite:///:memory:", "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing", "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE": "habitloop-analytics", "DYNAMODB_ENDPOINT": "",
    }.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    with mock_aws():
        boto3.resource("dynamodb", region_name="ap-south-1").create_table(
            TableName="habitloop-analytics", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": name, "KeyType": kind} for name, kind in (("PK", "HASH"), ("SK", "RANGE"))],
            AttributeDefinitions=[{"AttributeName": name, "AttributeType": "S"} for name in ("PK", "SK")],
        )
        spec = importlib.util.spec_from_file_location("tested_analytics_updater", Path(__file__).resolve().parents[1] / "handler.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        yield module
    get_settings.cache_clear()


@pytest.fixture
def detail() -> dict[str, Any]:
    return {"tenant_id": str(uuid4()), "user_id": str(uuid4()), "activity_id": str(uuid4()),
            "log_id": str(uuid4()), "status": "done", "logged_at": "2026-11-19T07:30:00Z", "challenge_ids": []}


def item(detail: dict[str, Any], sk: str, pk: str | None = None) -> dict[str, Any]:
    return analytics_table().get_item(Key={"PK": pk or user_pk(detail["tenant_id"], detail["user_id"]), "SK": sk},
                                     ConsistentRead=True).get("Item", {})


def test_duplicate_counts_all_aggregates_once(updater: ModuleType, detail: dict[str, Any]) -> None:
    event = {"detail-type": "ActivityLogged", "detail": detail}
    assert updater.handler(event, None) == {"batchItemFailures": []}
    updater.handler(detail, None)
    assert item(detail, "DAY#2026-11-19")["done"] == 1
    assert item(detail, "STREAK")["current"] == 1
    assert item(detail, "STREAK")["revision"] == 1
    assert item(detail, "HOUR#07")["attempts"] == 1
    assert item(detail, "HOUR#07")["successes"] == 1
    assert item(detail, "COHORT#2026-11-16")["done"] == 1
    assert item(detail, f"SEEN#{detail['log_id']}")
    assert item(detail, f"ACTIVITY#{detail['activity_id']}#DAY#2026-11-19")["done"] == 1
    assert not query_items(analytics_table(), user_pk(str(uuid4()), detail["user_id"]), "DAY#")
    other = {**detail, "tenant_id": str(uuid4())}
    updater.handler(other, None)
    assert item(other, "DAY#2026-11-19")["done"] == 1


def test_multiple_logs_gap_missed_late_arrivals(updater: ModuleType, detail: dict[str, Any]) -> None:
    for day, status in [(17, "done"), (19, "completed"), (18, "done"), (19, "done")]:
        updater.handler({**detail, "log_id": str(uuid4()), "status": status,
                         "logged_at": f"2026-11-{day}T07:00:00Z"}, None)
    assert item(detail, "STREAK")["current"] == 3
    assert item(detail, "STREAK")["best"] == 3
    updater.handler({**detail, "log_id": str(uuid4()), "status": "missed", "logged_at": "2026-11-18T08:00:00Z"}, None)
    assert item(detail, "STREAK")["current"] == 1
    assert item(detail, "STREAK")["best"] == 3
    updater.handler({**detail, "log_id": str(uuid4()), "status": "missed"}, None)
    assert item(detail, "STREAK")["current"] == 0
    updater.handler({**detail, "log_id": str(uuid4()), "status": "completed"}, None)
    assert item(detail, "STREAK")["current"] == 0


def test_utc_day_hour_and_week_boundaries(updater: ModuleType, detail: dict[str, Any]) -> None:
    updater.handler({**detail, "logged_at": "2026-11-16T01:00:00+05:30"}, None)
    assert item(detail, "DAY#2026-11-15")["done"] == 1
    assert item(detail, "HOUR#19")["successes"] == 1
    assert item(detail, "COHORT#2026-11-09")["attempts"] == 1


@pytest.mark.parametrize("threshold", [7, 30, 100])
def test_badges_earned_once_and_retained(updater: ModuleType, detail: dict[str, Any], threshold: int) -> None:
    table = analytics_table()
    pk = user_pk(detail["tenant_id"], detail["user_id"])
    end = date(2026, 11, 19)
    with table.batch_writer() as batch:
        for offset in range(1, threshold):
            day = (end - timedelta(days=offset)).isoformat()
            for prefix in ("", f"ACTIVITY#{detail['activity_id']}#"):
                batch.put_item(Item={"PK": pk, "SK": f"{prefix}DAY#{day}", "date": day, "done": 1})
    updater.handler(detail, None)
    for prefix in ("", f"ACTIVITY#{detail['activity_id']}#"):
        assert item(detail, f"{prefix}BADGE#{threshold}")["earned_date"] == "2026-11-19"
    updater.handler({**detail, "log_id": str(uuid4()), "status": "missed"}, None)
    for prefix in ("", f"ACTIVITY#{detail['activity_id']}#"):
        assert item(detail, f"{prefix}BADGE#{threshold}")["earned_date"] == "2026-11-19"
        assert item(detail, f"{prefix}STREAK")["current"] == 0
        assert item(detail, f"{prefix}STREAK")["best"] == threshold


def test_failed_transaction_leaves_no_marker_and_retries(
    updater: ModuleType, detail: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_client = updater.boto3.client
    state = {"fail": True}

    def client(*args: Any, **kwargs: Any) -> Any:
        result = real_client(*args, **kwargs)
        transact = result.transact_write_items

        def write(**params: Any) -> Any:
            if state["fail"]:
                raise ClientError({"Error": {"Code": "InternalServerError", "Message": "retry"}}, "TransactWriteItems")
            return transact(**params)

        result.transact_write_items = write
        return result

    monkeypatch.setattr(updater.boto3, "client", client)
    with pytest.raises(ClientError):
        updater.handler(detail, None)
    assert item(detail, f"SEEN#{detail['log_id']}") == {}
    assert item(detail, "DAY#2026-11-19") == {}
    state["fail"] = False
    updater.handler(detail, None)
    assert item(detail, "DAY#2026-11-19")["done"] == 1


def test_revision_conflict_reloads_history(
    updater: ModuleType, detail: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_client = updater.boto3.client
    state = {"calls": 0}

    def client(*args: Any, **kwargs: Any) -> Any:
        result = real_client(*args, **kwargs)
        transact = result.transact_write_items

        def write(**params: Any) -> Any:
            state["calls"] += 1
            if state["calls"] == 1:
                pk = user_pk(detail["tenant_id"], detail["user_id"])
                analytics_table().put_item(Item={"PK": pk, "SK": "STREAK", "revision": 1})
                analytics_table().put_item(Item={"PK": pk, "SK": "DAY#2026-11-18", "date": "2026-11-18", "done": 1})
            return transact(**params)

        result.transact_write_items = write
        return result

    monkeypatch.setattr(updater.boto3, "client", client)
    updater.handler(detail, None)
    assert state["calls"] == 2
    assert item(detail, "STREAK")["revision"] == 2
    assert item(detail, "STREAK")["current"] == 2
    assert item(detail, "DAY#2026-11-19")["done"] == 1


def test_challenge_progress_targets_duplicate_ids_and_missed(
    updater: ModuleType, detail: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid, cid2 = str(uuid4()), str(uuid4())
    real_client = httpx.Client
    calls: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        claims = jwt.decode(request.headers["Authorization"].removeprefix("Bearer "),
                            get_settings().jwt_secret.get_secret_value(), algorithms=["HS256"])
        assert claims["tenant_id"] == detail["tenant_id"] and claims["sub"] == detail["user_id"]
        calls.append(request.url.path)
        return httpx.Response(200, json={"target_count": 10})

    monkeypatch.setattr(updater.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    detail["challenge_ids"] = [cid, cid2, cid]
    updater.handler(detail, None)
    updater.handler(detail, None)
    assert len(calls) == 2
    updater.handler({**detail, "log_id": str(uuid4()), "status": "missed"}, None)
    for challenge_id in (cid, cid2):
        assert item(detail, f"PROGRESS#{challenge_id}")["count"] == 1
        assert item(detail, f"PROGRESS#{challenge_id}")["target"] == 10
        board = item(detail, f"PROGRESS#{detail['user_id']}", challenge_pk(detail["tenant_id"], challenge_id))
        assert board["count"] == 1 and board["target"] == 10
        assert not query_items(analytics_table(), challenge_pk(str(uuid4()), challenge_id), "PROGRESS#")


def test_sqs_partial_failures_and_duplicate_records(updater: ModuleType, detail: dict[str, Any]) -> None:
    records = [{"messageId": "ok", "body": json.dumps({"detail": detail})},
               {"messageId": "bad-json", "body": "{"},
               {"messageId": "bad-status", "body": json.dumps({**detail, "status": "bad"})},
               {"messageId": "retry", "body": json.dumps(detail)}]
    assert updater.handler({"Records": records}, None) == {"batchItemFailures": [
        {"itemIdentifier": "bad-json"}, {"itemIdentifier": "bad-status"},
    ]}
    assert item(detail, "DAY#2026-11-19")["done"] == 1
    assert updater.handler({"Records": []}, None) == {"batchItemFailures": []}


def test_query_reads_all_pages_and_keeps_partition(updater: ModuleType, detail: dict[str, Any]) -> None:
    class PagedTable:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def query(self, **kwargs: Any) -> dict[str, Any]:
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return {"Items": [{"date": "2026-11-18"}], "LastEvaluatedKey": {"PK": "p", "SK": "s"}}
            return {"Items": [{"date": "2026-11-19"}]}

    table = PagedTable()
    assert len(query_items(table, user_pk(detail["tenant_id"], detail["user_id"]), "DAY#")) == 2
    assert table.calls[1]["ExclusiveStartKey"] == {"PK": "p", "SK": "s"}
    assert table.calls[0]["ConsistentRead"] is True
    assert table.calls[0]["KeyConditionExpression"] is table.calls[1]["KeyConditionExpression"]
