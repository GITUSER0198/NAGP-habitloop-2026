"""Isolated DynamoDB tables, tenant identities and the production updater."""

import importlib.util
import secrets
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any
from uuid import uuid4

import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from habitloop_shared.auth import encode_token
from habitloop_shared.config import get_settings

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name, value in {
        "JWT_SECRET": secrets.token_urlsafe(64), "INTERNAL_TOKEN": secrets.token_urlsafe(32),
        "DATABASE_URL": "sqlite+pysqlite:///:memory:", "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing", "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE": "habitloop-analytics", "DYNAMODB_ENDPOINT": "",
    }.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def table() -> Iterator[Any]:
    with mock_aws():
        table = boto3.resource("dynamodb", region_name="ap-south-1").create_table(
            TableName="habitloop-analytics", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": name, "KeyType": kind} for name, kind in (("PK", "HASH"), ("SK", "RANGE"))],
            AttributeDefinitions=[{"AttributeName": name, "AttributeType": "S"} for name in ("PK", "SK")],
        )
        yield table


@pytest.fixture
def updater() -> ModuleType:
    path = Path(__file__).resolve().parents[3] / "lambdas" / "analytics-updater" / "handler.py"
    spec = importlib.util.spec_from_file_location("analytics_test_updater", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def identity() -> dict[str, str]:
    return {"tenant_id": str(uuid4()), "user_id": str(uuid4())}


@pytest.fixture
def headers(identity: dict[str, str]) -> dict[str, str]:
    return {"Authorization": "Bearer " + encode_token(**identity, email="test@example.com", name="Tester")}


@pytest.fixture
def client(table: Any, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from datetime import date

    from app import routes
    from app.main import app

    monkeypatch.setattr(routes, "today", lambda: date(2026, 11, 19))
    with TestClient(app) as client:
        assert not hasattr(app.state, "engine")
        yield client
