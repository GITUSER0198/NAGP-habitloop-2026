"""Normalize partner events in AWS Lambda and the local event worker."""

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime
from typing import Any
from uuid import UUID

import requests

logger = logging.getLogger(__name__)


def service_headers(detail: dict[str, Any]) -> dict[str, str]:
    """Sign a short-lived tenant identity without Lambda-only dependencies."""
    def encoded(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    now = int(time.time())
    claims = {
        "sub": detail["user_id"], "tenant_id": detail["tenant_id"],
        "email": "partner@habitloop.internal", "name": "Partner normalizer",
        "iat": now, "exp": now + 3600,
    }
    header = encoded(json.dumps({"alg": "HS256", "typ": "JWT"}).encode("utf-8"))
    payload = encoded(json.dumps(claims).encode("utf-8"))
    signing_input = f"{header}.{payload}"
    signature = encoded(hmac.new(
        os.environ["JWT_SECRET"].encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256,
    ).digest())
    return {
        "Authorization": f"Bearer {signing_input}.{signature}",
        "X-Internal-Token": os.environ["INTERNAL_TOKEN"],
    }


def mark(detail: dict[str, Any], headers: dict[str, str], status: str, reason: str | None = None) -> None:
    body = {"status": status}
    if reason is not None:
        body["reason"] = reason
    response = requests.patch(
        f"{os.environ['INTEGRATION_SERVICE_URL'].rstrip('/')}/api/integrations/internal/events/{detail['partner_event_id']}",
        headers=headers, json=body, timeout=10,
    )
    response.raise_for_status()


def validate_workout(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Workout must be an object")
    if raw.get("type") != "workout":
        raise ValueError("Unsupported partner event type")
    for field in ("event_id", "provider_activity"):
        value = raw.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > 255:
            raise ValueError(f"Invalid {field}")
    if type(raw.get("duration_min")) is not int or raw["duration_min"] < 0:
        raise ValueError("duration_min must be a nonnegative integer")
    if raw.get("steps") is not None and (type(raw["steps"]) is not int or raw["steps"] < 0):
        raise ValueError("steps must be a nonnegative integer")
    started = raw.get("started_at")
    if not isinstance(started, str):
        raise ValueError("started_at must be an ISO timestamp with timezone")
    try:
        parsed = datetime.fromisoformat(started)
    except ValueError:
        raise ValueError("started_at must be an ISO timestamp with timezone") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("started_at must include a timezone")
    return raw


def normalize(detail: dict[str, Any]) -> None:
    if not isinstance(detail, dict):
        raise ValueError("Event detail must be an object")
    # Missing identity cannot safely address an event or mint a tenant token.
    for field in ("tenant_id", "user_id", "link_id", "partner_event_id"):
        detail[field] = str(UUID(detail[field]))
    headers = service_headers(detail)
    try:
        if detail.get("provider") not in {"mockfit", "mockrun"}:
            raise ValueError("Unsupported provider")
        raw = validate_workout(detail.get("raw"))
    except ValueError as exc:
        mark(detail, headers, "rejected", str(exc))
        return

    response = requests.get(
        f"{os.environ['INTEGRATION_SERVICE_URL'].rstrip('/')}/api/integrations/links",
        headers=headers, timeout=10,
    )
    response.raise_for_status()
    links = response.json()
    if not isinstance(links, list):
        raise ValueError("Expected a list of integration links")
    link = next((item for item in links if item.get("id") == detail["link_id"]), None)
    if link is None or link.get("status") != "active":
        mark(detail, headers, "rejected", "Link is no longer active")
        return
    if any(link.get(key) != detail[key] for key in ("tenant_id", "user_id", "provider")):
        mark(detail, headers, "rejected", "Partner event does not match link identity")
        return
    activity_id = link["activity_map"].get(raw["provider_activity"])
    if activity_id is None:
        mark(detail, headers, "rejected", f"Unmapped provider activity: {raw['provider_activity']}")
        return
    try:
        activity_id = str(UUID(activity_id))
    except (ValueError, TypeError, AttributeError):
        mark(detail, headers, "rejected", "Mapped activity ID is invalid")
        return
    status = "completed" if raw["duration_min"] >= 20 or (raw.get("steps") or 0) >= 5000 else "done"
    response = requests.post(
        f"{os.environ['ACTIVITY_SERVICE_URL'].rstrip('/')}/api/activities/internal/logs",
        headers=headers, timeout=10, json={
            "tenant_id": detail["tenant_id"], "user_id": detail["user_id"],
            "activity_id": activity_id, "status": status, "logged_at": raw["started_at"],
            "duration_min": raw["duration_min"], "source": "partner",
            "source_event_id": detail["partner_event_id"],
            "metadata": {"provider": detail["provider"], "link_id": detail["link_id"],
                         "event_id": raw["event_id"], "steps": raw.get("steps")},
        },
    )
    if response.status_code in {404, 409, 422}:
        mark(detail, headers, "rejected", f"Activity log rejected (HTTP {response.status_code})")
        return
    # Network, auth and server failures must retry, including failures after log creation.
    response.raise_for_status()
    mark(detail, headers, "normalized")


def event_detail(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ValueError("Expected an event object")
    if "detail-type" in event:
        if event["detail-type"] != "PartnerEventReceived":
            raise ValueError("Expected PartnerEventReceived")
        return event["detail"]
    return event


def handler(event: dict[str, Any], context: Any) -> dict[str, list[dict[str, str]]]:
    if "Records" not in event:
        normalize(event_detail(event))
        return {"batchItemFailures": []}
    failures: list[dict[str, str]] = []
    for record in event["Records"]:
        message_id = record["messageId"]
        try:
            normalize(event_detail(json.loads(record["body"])))
        except Exception:
            # Do not log partner payloads, tokens or requests exception headers.
            logger.warning("partner_normalization_failed", extra={"message_id": message_id})
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
