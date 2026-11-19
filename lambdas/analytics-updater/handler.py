"""Atomically aggregate ActivityLogged events locally and from EventBridge/SQS."""

import json
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import boto3
import httpx
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from habitloop_shared.analytics import (
    STATUSES, analytics_table, challenge_pk, query_items, streaks, user_pk,
)
from habitloop_shared.auth import encode_token
from habitloop_shared.config import get_settings

logger = logging.getLogger(__name__)


def challenge_targets(detail: dict[str, Any], ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    settings = get_settings()
    token = encode_token(detail["user_id"], detail["tenant_id"], "analytics@habitloop.internal", "Analytics updater")
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Internal-Token": settings.internal_token.get_secret_value(),
    }
    targets: dict[str, int] = {}
    with httpx.Client(timeout=3.0) as client:
        for cid in ids:
            response = client.get(f"{settings.challenge_service_url}/api/challenges/{cid}", headers=headers)
            response.raise_for_status()
            targets[cid] = int(response.json()["target_count"])
    return targets


def aggregate(detail: dict[str, Any]) -> None:
    tenant_id, user_id, activity_id, log_id = (
        str(UUID(detail[field])) for field in ("tenant_id", "user_id", "activity_id", "log_id")
    )
    status = detail["status"]
    if status not in STATUSES:
        raise ValueError("Unknown activity status")
    logged = datetime.fromisoformat(detail["logged_at"])
    if logged.tzinfo is None or logged.utcoffset() is None:
        raise ValueError("logged_at requires a timezone")
    logged = logged.astimezone(timezone.utc)
    day = logged.date().isoformat()
    week = (logged.date() - timedelta(days=logged.weekday())).isoformat()
    ids = sorted({str(UUID(cid)) for cid in detail.get("challenge_ids", [])})
    pk = user_pk(tenant_id, user_id)
    table = analytics_table()
    seen_key = {"PK": pk, "SK": f"SEEN#{log_id}"}
    if "Item" in table.get_item(Key=seen_key, ConsistentRead=True):
        return
    targets = challenge_targets(detail, ids)
    serializer = TypeSerializer()
    # Resource clients serialize native values, so use a separate low-level transaction client.
    client = boto3.client("dynamodb", region_name=table.meta.client.meta.region_name,
                          endpoint_url=table.meta.client.meta.endpoint_url,
                          config=table.meta.client.meta.config)

    def encoded(item: dict[str, Any]) -> dict[str, Any]:
        return {key: serializer.serialize(value) for key, value in item.items()}

    def put(item: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        return {"Put": {"TableName": table.name, "Item": encoded(item), **kwargs}}

    def add(target_pk: str, sk: str, values: dict[str, int], **attributes: Any) -> dict[str, Any]:
        names = {f"#n{index}": name for index, name in enumerate(values)}
        params = {f":v{index}": value for index, value in enumerate(values.values())}
        expression = "ADD " + ", ".join(f"#n{index} :v{index}" for index in range(len(values)))
        if attributes:
            setters = []
            for index, (name, value) in enumerate(attributes.items()):
                names[f"#s{index}"] = name
                params[f":s{index}"] = value
                setters.append(f"#s{index} = :s{index}")
            expression += " SET " + ", ".join(setters)
        return {"Update": {
            "TableName": table.name, "Key": encoded({"PK": target_pk, "SK": sk}),
            "UpdateExpression": expression, "ExpressionAttributeNames": names,
            "ExpressionAttributeValues": encoded(params),
        }}

    for attempt in range(8):
        # Read the revision before history. The conditional write detects any intervening writer.
        old = table.get_item(Key={"PK": pk, "SK": "STREAK"}, ConsistentRead=True).get("Item", {})
        revision = int(old.get("revision", 0))
        writes = [put({**seen_key, "logged_at": logged.isoformat()}, ConditionExpression="attribute_not_exists(PK)")]
        for prefix in ("", f"ACTIVITY#{activity_id}#"):
            days = query_items(table, pk, f"{prefix}DAY#")
            row = next((item for item in days if item["date"] == day), None)
            if row is None:
                row = {"date": day}
                days.append(row)
            row[status] = int(row.get(status, 0)) + 1
            calculated, earned = streaks(days)
            previous = old if not prefix else table.get_item(
                Key={"PK": pk, "SK": f"{prefix}STREAK"}, ConsistentRead=True,
            ).get("Item", {})
            calculated["best"] = max(calculated["best"], int(previous.get("best", 0)))
            item = {"PK": pk, "SK": f"{prefix}STREAK", **calculated}
            condition: dict[str, Any] = {}
            if not prefix:
                item["revision"] = revision + 1
                condition = {
                    "ConditionExpression": "attribute_not_exists(revision) OR revision = :revision",
                    "ExpressionAttributeValues": encoded({":revision": revision}),
                }
            writes.append(put(item, **condition))
            writes.append(add(pk, f"{prefix}DAY#{day}", {status: 1}, date=day))
            for threshold, earned_date in earned.items():
                writes.append({"Update": {
                    "TableName": table.name,
                    "Key": encoded({"PK": pk, "SK": f"{prefix}BADGE#{threshold}"}),
                    "UpdateExpression": "SET days = :days, earned_date = if_not_exists(earned_date, :earned)",
                    "ExpressionAttributeValues": encoded({":days": threshold, ":earned": earned_date}),
                }})
        success = int(status != "missed")
        writes.append(add(pk, f"HOUR#{logged.hour:02d}", {"attempts": 1, "successes": success}))
        writes.append(add(pk, f"COHORT#{week}", {status: 1, "attempts": 1, "successes": success}, week=week))
        for cid in ids:
            writes.append(add(pk, f"PROGRESS#{cid}", {"count": success}, target=targets[cid]))
            writes.append(add(challenge_pk(tenant_id, cid), f"PROGRESS#{user_id}", {"count": success},
                              user_id=user_id, target=targets[cid]))
        if len(writes) > 100:
            raise ValueError("Activity event exceeds DynamoDB transaction capacity")
        try:
            client.transact_write_items(TransactItems=writes)
            return
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "TransactionCanceledException":
                raise
            if "Item" in table.get_item(Key=seen_key, ConsistentRead=True):
                return
            reasons = exc.response.get("CancellationReasons", [])
            if any(reason["Code"] not in {"None", "ConditionalCheckFailed", "TransactionConflict"} for reason in reasons):
                raise
            if attempt == 7:
                raise
            time.sleep(random.uniform(0.01, 0.03) * (attempt + 1))


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if "Records" not in event:
        aggregate(event.get("detail", event))
        return {"batchItemFailures": []}
    failures = []
    for record in event["Records"]:
        try:
            envelope = json.loads(record["body"])
            aggregate(envelope.get("detail", envelope))
        except Exception:
            logger.exception("analytics_update_failed")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
