"""Local dispatch shell, with handlers added by subsequent pipeline tasks."""

import logging
from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field

from habitloop_shared.auth import internal_only
from habitloop_shared.config import get_settings
from habitloop_shared.logging import RequestIDMiddleware, configure_logging, tenant_id_context

settings = get_settings()
configure_logging("event-worker", settings.log_level)
app = FastAPI(title="HabitLoop event worker")
app.add_middleware(RequestIDMiddleware)
logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any]], Awaitable[None]]
handlers: dict[str, list[Handler]] = {}


class Event(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    detail_type: str = Field(alias="detail-type", min_length=1)
    detail: dict[str, Any]
    source: str | None = None


def register_handler(detail_type: str, handler: Handler) -> None:
    handlers.setdefault(detail_type, []).append(handler)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "event-worker"}


@app.post("/events", status_code=202)
async def receive_event(event: Event, _: Annotated[None, Depends(internal_only)]) -> dict[str, str]:
    tenant_id = event.detail.get("tenant_id")
    if isinstance(tenant_id, str):
        tenant_id_context.set(tenant_id)
    registered = handlers.get(event.detail_type, [])
    logger.info("event_received", extra={"fields": {
        "detail_type": event.detail_type, "handler_count": len(registered),
    }})
    for handler in registered:
        await handler(event.detail)
    return {"status": "accepted"}
