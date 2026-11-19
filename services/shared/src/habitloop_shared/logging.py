"""JSON logging with request-local correlation and tenant context."""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
tenant_id_context: ContextVar[str | None] = ContextVar("tenant_id", default=None)
_service_name = "habitloop"


def get_service_name() -> str:
    return _service_name


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %I:%M:%S %p UTC"),
            "level": record.levelname,
            "service": _service_name,
            "request_id": request_id_context.get(),
            "tenant_id": tenant_id_context.get(),
            "message": record.getMessage(),
        }
        payload.update(getattr(record, "fields", {}))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(service: str, level: str) -> None:
    global _service_name
    _service_name = service
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


class RequestIDMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        request_id = headers.get(b"x-request-id", b"").decode("latin-1")
        if not request_id or len(request_id) > 128:
            request_id = str(uuid4())
        request_token = request_id_context.set(request_id)
        tenant_token = tenant_id_context.set(None)
        status = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                response_headers = [
                    (key, value) for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ]
                response_headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = response_headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            logging.getLogger("habitloop.request").info(
                "request_completed",
                extra={"fields": {"method": scope["method"], "path": scope["path"], "status": status}},
            )
            tenant_id_context.reset(tenant_token)
            request_id_context.reset(request_token)
