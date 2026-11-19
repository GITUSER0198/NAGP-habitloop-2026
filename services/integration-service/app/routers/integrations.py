"""Tenant-owned wearable links and capability-authenticated ingestion."""

import hashlib
import hmac
import secrets
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from habitloop_shared import events
from habitloop_shared.auth import CurrentUser, current_user, internal_only
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_db

from app.models import Link, PartnerEvent
from app.schemas import (
    PROVIDERS, EventPatch, EventResponse, LinkCreate, LinkCreated, LinkResponse, Workout,
)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
Database = Annotated[Session, Depends(get_db)]
Identity = Annotated[CurrentUser, Depends(current_user)]


def owned_link(db: Session, link_id: UUID, identity: CurrentUser) -> Link:
    link = db.scalar(select(Link).where(
        Link.id == link_id, Link.tenant_id == UUID(identity["tenant_id"]),
        Link.user_id == UUID(identity["user_id"]), Link.status == "active",
    ))
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    return link


@router.get("/providers")
def providers(identity: Identity) -> list[dict[str, Any]]:
    return [{"provider": name, "activity_types": types} for name, types in PROVIDERS.items()]


@router.post("/links", response_model=LinkCreated, status_code=201)
def create_link(body: LinkCreate, identity: Identity, db: Database, request: Request) -> LinkCreated:
    if body.activity_map:
        try:
            with httpx.Client(timeout=5.0) as client:
                for activity_id in set(body.activity_map.values()):
                    response = client.get(
                        f"{get_settings().activity_service_url}/api/activities/{activity_id}",
                        headers={"Authorization": request.headers["Authorization"]},
                    )
                    if response.status_code == 404:
                        raise HTTPException(status_code=422, detail="Mapped activity not found")
                    response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Mapped activities could not be validated") from None
    # HMAC-SHA256 reduces keys longer than its 64-byte block to SHA256(key).
    # Generate 86 ASCII bytes so only the hash is stored, with standard wire HMAC.
    ingest_key = secrets.token_urlsafe(64)
    link = Link(
        tenant_id=UUID(identity["tenant_id"]), user_id=UUID(identity["user_id"]),
        provider=body.provider, activity_map={key: str(value) for key, value in body.activity_map.items()},
        ingest_key_hash=hashlib.sha256(ingest_key.encode("ascii")).hexdigest(),
    )
    db.add(link)
    db.commit()
    return LinkCreated(**LinkResponse.model_validate(link).model_dump(), ingest_key=ingest_key)


@router.get("/links", response_model=list[LinkResponse])
def list_links(identity: Identity, db: Database) -> list[Link]:
    return list(db.scalars(select(Link).where(
        Link.tenant_id == UUID(identity["tenant_id"]), Link.user_id == UUID(identity["user_id"]),
        Link.status == "active",
    ).order_by(Link.created_at.desc(), Link.id.desc())).all())


@router.delete("/links/{id}", status_code=204)
def delete_link(id: UUID, identity: Identity, db: Database) -> Response:
    link = owned_link(db, id, identity)
    link.status = "deleted"
    db.commit()
    return Response(status_code=204)


@router.get("/links/{id}/events", response_model=list[EventResponse])
def list_events(id: UUID, identity: Identity, db: Database) -> list[PartnerEvent]:
    owned_link(db, id, identity)
    return list(db.scalars(select(PartnerEvent).where(
        PartnerEvent.tenant_id == UUID(identity["tenant_id"]), PartnerEvent.link_id == id,
    ).order_by(PartnerEvent.received_at.desc(), PartnerEvent.id.desc()).limit(50)).all())


@router.post("/ingest/{link_id}", status_code=202)
async def ingest(
    link_id: UUID, request: Request, db: Database, response: Response,
    signature: Annotated[str | None, Header(alias="X-HabitLoop-Signature")] = None,
) -> dict[str, Any]:
    # The ingest capability supplies identity here, not a user bearer token.
    # Resolve the tenant from the link before any tenant-scoped event query.
    link = db.scalar(select(Link).where(Link.id == link_id, Link.status == "active"))
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    raw_body = await request.body()
    expected = "sha256=" + hmac.new(
        bytes.fromhex(link.ingest_key_hash), raw_body, hashlib.sha256,
    ).hexdigest()
    if signature is None or not hmac.compare_digest(signature.encode("utf-8"), expected.encode("ascii")):
        raise HTTPException(status_code=401, detail="Invalid or missing partner signature")
    try:
        body = Workout.model_validate_json(raw_body)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from None
    existing = db.scalar(select(PartnerEvent).where(
        PartnerEvent.tenant_id == link.tenant_id, PartnerEvent.link_id == link.id,
        PartnerEvent.event_id == body.event_id,
    ))
    if existing is not None:
        response.status_code = 200
        return {"duplicate": True}
    partner_event = PartnerEvent(
        tenant_id=link.tenant_id, link_id=link.id, event_id=body.event_id,
        payload=body.model_dump(mode="json", exclude_none=True),
    )
    db.add(partner_event)
    try:
        # Commit before dispatch: a synchronous local handler must see this row.
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(PartnerEvent).where(
            PartnerEvent.tenant_id == link.tenant_id, PartnerEvent.link_id == link.id,
            PartnerEvent.event_id == body.event_id,
        ))
        if existing is None:
            raise
        response.status_code = 200
        return {"duplicate": True}
    try:
        # Keep blocking dispatch out of the ASGI loop: the worker calls us back.
        await run_in_threadpool(events.publish, "PartnerEventReceived", {
            "tenant_id": str(link.tenant_id), "user_id": str(link.user_id),
            "link_id": str(link.id), "partner_event_id": str(partner_event.id),
            "provider": link.provider, "raw": partner_event.payload,
        })
    except (httpx.HTTPError, RuntimeError):
        raise HTTPException(status_code=502, detail="Partner event was stored but dispatch failed") from None
    return {"id": str(partner_event.id), "status": "received"}


@router.patch(
    "/internal/events/{id}", response_model=EventResponse,
    dependencies=[Depends(internal_only)], include_in_schema=False,
)
def mark_event(id: UUID, body: EventPatch, identity: Identity, db: Database) -> PartnerEvent:
    partner_event = db.scalar(select(PartnerEvent).join(Link, Link.id == PartnerEvent.link_id).where(
        PartnerEvent.id == id, PartnerEvent.tenant_id == UUID(identity["tenant_id"]),
        Link.tenant_id == UUID(identity["tenant_id"]), Link.user_id == UUID(identity["user_id"]),
    ))
    if partner_event is None:
        raise HTTPException(status_code=404, detail="Partner event not found")
    partner_event.status = body.status
    partner_event.reason = body.reason
    db.commit()
    return partner_event
