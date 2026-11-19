"""Local event dispatch using the same normalizer as AWS Lambda."""

import importlib.util
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

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


normalizer_path = next(
    parent / "lambdas" / "event-normalizer" / "handler.py"
    for parent in Path(__file__).resolve().parents
    if (parent / "lambdas" / "event-normalizer" / "handler.py").is_file()
)
normalizer_spec = importlib.util.spec_from_file_location("event_normalizer", normalizer_path)
if normalizer_spec is None or normalizer_spec.loader is None:
    raise RuntimeError("Event normalizer could not be loaded")
normalizer = importlib.util.module_from_spec(normalizer_spec)
normalizer_spec.loader.exec_module(normalizer)


async def normalize_partner(detail: dict[str, Any]) -> None:
    await run_in_threadpool(normalizer.handler, detail, None)


register_handler("PartnerEventReceived", normalize_partner)


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
