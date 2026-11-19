"""DynamoDB access and calendar streak rules shared by analytics readers and writers."""

import os
from datetime import date, timedelta
from typing import Any
from uuid import UUID

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

BADGE_DAYS = (7, 30, 100)
STATUSES = ("done", "completed", "missed")


def analytics_table() -> Any:
    return boto3.resource(
        "dynamodb", region_name=os.environ.get("AWS_REGION", "ap-south-1"),
        endpoint_url=os.environ.get("DYNAMODB_ENDPOINT") or None,
        config=Config(connect_timeout=2, read_timeout=2, retries={"max_attempts": 2}),
    ).Table(os.environ.get("DYNAMODB_TABLE", "habitloop-analytics"))


def user_pk(tenant_id: str, user_id: str) -> str:
    return f"TENANT#{UUID(tenant_id)}#USER#{UUID(user_id)}"


def challenge_pk(tenant_id: str, challenge_id: str) -> str:
    return f"TENANT#{UUID(tenant_id)}#CHALLENGE#{UUID(challenge_id)}"


def query_items(table: Any, pk: str, prefix: str) -> list[dict[str, Any]]:
    """Read every page within one tenant-qualified partition and sort-key prefix."""
    options: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with(prefix),
        "ConsistentRead": True,
    }
    items: list[dict[str, Any]] = []
    while True:
        response = table.query(**options)
        items.extend(response["Items"])
        if "LastEvaluatedKey" not in response:
            return items
        options["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def counts(item: dict[str, Any]) -> dict[str, int]:
    return {status: int(item.get(status, 0)) for status in STATUSES}


def streaks(days: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[int, str]]:
    """Recompute by calendar date, including delayed events and multiple logs per day."""
    current = best = 0
    previous: date | None = None
    earned: dict[int, str] = {}
    for item in sorted(days, key=lambda row: row["date"]):
        day = date.fromisoformat(item["date"])
        if previous is None or day != previous + timedelta(days=1):
            current = 0
        if item.get("missed", 0) or not (item.get("done", 0) + item.get("completed", 0)):
            current = 0
        else:
            current += 1
        best = max(best, current)
        for threshold in BADGE_DAYS:
            if current >= threshold:
                earned.setdefault(threshold, day.isoformat())
        previous = day
    return {"current": current, "best": best, "last_date": previous.isoformat() if previous else None}, earned


def live_streak(item: dict[str, Any], today: date) -> int:
    last = item.get("last_date")
    if last is None or not today - timedelta(days=1) <= date.fromisoformat(last) <= today:
        return 0
    return int(item.get("current", 0))
