"""Publish the same event envelope locally and through EventBridge."""

import json
from typing import Any

import boto3
import httpx

from habitloop_shared.config import get_settings
from habitloop_shared.logging import get_service_name, request_id_context


def publish(detail_type: str, detail: dict[str, Any]) -> None:
    settings = get_settings()
    source = f"habitloop.{get_service_name().removesuffix('-service')}"
    if settings.event_bus_mode == "local":
        headers = {"X-Internal-Token": settings.internal_token.get_secret_value()}
        if request_id := request_id_context.get():
            headers["X-Request-ID"] = request_id
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                settings.event_worker_url,
                json={"source": source, "detail-type": detail_type, "detail": detail},
                headers=headers,
            )
            response.raise_for_status()
        return
    client = boto3.client("events", region_name=settings.aws_region)
    result = client.put_events(Entries=[{
        "Source": source, "DetailType": detail_type, "Detail": json.dumps(detail),
        "EventBusName": settings.event_bus_name,
    }])
    if result.get("FailedEntryCount", 0):
        raise RuntimeError("EventBridge failed to publish event")
