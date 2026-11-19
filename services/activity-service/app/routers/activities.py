"""Tenant-scoped habits and authenticated internal logging endpoints."""

import logging
from datetime import datetime, time, timedelta, timezone
from typing import Annotated, Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import AwareDatetime, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from habitloop_shared import events
from habitloop_shared.auth import CurrentUser, current_user, internal_only
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_db

from app.categories import load_categories
from app.models import Activity, ActivityLog
from app.schemas import (
    ActivityCreate, ActivityPatch, ActivityResponse, LogCreate, LogResponse,
    PartnerLogCreate, SchedulePatch, TodayItem,
)

router = APIRouter(prefix="/api/activities", tags=["activities"])
Database = Annotated[Session, Depends(get_db)]
Identity = Annotated[CurrentUser, Depends(current_user)]
logger = logging.getLogger(__name__)


def service_headers(request: Request) -> dict[str, str]:
    headers = {"X-Internal-Token": get_settings().internal_token.get_secret_value()}
    if authorization := request.headers.get("Authorization"):
        headers["Authorization"] = authorization
    return headers


def find_activity(db: Session, activity_id: UUID, tenant_id: UUID, user_id: UUID) -> Activity:
    activity = db.scalar(select(Activity).where(
        Activity.id == activity_id, Activity.tenant_id == tenant_id, Activity.user_id == user_id,
    ))
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


def owned_activity(db: Session, activity_id: UUID, identity: CurrentUser) -> Activity:
    return find_activity(db, activity_id, UUID(identity["tenant_id"]), UUID(identity["user_id"]))


def patch_activity(activity: Activity, body: ActivityPatch | SchedulePatch, db: Session) -> Activity:
    if not activity.active:
        raise HTTPException(status_code=409, detail="Activity is no longer active")
    merged = {field: getattr(activity, field) for field in ActivityCreate.model_fields}
    merged.update(body.model_dump(exclude_unset=True))
    try:
        validated = ActivityCreate.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from None
    for field, value in validated.model_dump().items():
        setattr(activity, field, value)
    db.commit()
    return activity


def challenge_ids(activity: Activity, request: Request) -> list[str]:
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(
                f"{get_settings().challenge_service_url}/api/challenges/internal/users/{activity.user_id}/active",
                params={"category": activity.category}, headers=service_headers(request),
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise ValueError("Expected challenge IDs")
            return [str(UUID(value)) for value in payload]
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        logger.warning("challenge_lookup_failed")
        return []


def persist_log(
    db: Session, activity: Activity, body: LogCreate, request: Request,
    source: str = "manual", source_event_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ActivityLog:
    if not activity.active:
        raise HTTPException(status_code=404, detail="Activity not found")
    occurrence = ActivityLog(
        tenant_id=activity.tenant_id, user_id=activity.user_id, activity_id=activity.id,
        status=body.status, logged_at=body.logged_at.astimezone(timezone.utc), source=source,
        source_event_id=source_event_id, duration_min=body.duration_min, metadata_=metadata or {},
    )
    db.add(occurrence)
    # Flush first: the unique constraint serializes concurrent partner retries before publishing.
    db.flush()
    try:
        events.publish("ActivityLogged", {
            "tenant_id": str(activity.tenant_id), "user_id": str(activity.user_id),
            "activity_id": str(activity.id), "log_id": str(occurrence.id),
            "status": occurrence.status, "logged_at": occurrence.logged_at.isoformat(),
            "source": source, "challenge_ids": challenge_ids(activity, request),
        })
    except (httpx.HTTPError, RuntimeError):
        db.rollback()
        raise HTTPException(status_code=502, detail="Activity event could not be published") from None
    db.commit()
    return occurrence


def duplicate_log(db: Session, tenant_id: UUID, source_event_id: str) -> ActivityLog | None:
    return db.scalar(select(ActivityLog).where(
        ActivityLog.tenant_id == tenant_id, ActivityLog.source_event_id == source_event_id,
    ))


@router.get("/categories")
def categories(identity: Identity) -> dict[str, str]:
    return load_categories()


@router.get("/today", response_model=list[TodayItem])
def today(identity: Identity, db: Database, request: Request) -> list[TodayItem]:
    settings = get_settings()
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(
                f"{settings.user_service_url}/api/users/internal/users/{identity['user_id']}",
                headers=service_headers(request),
            )
            response.raise_for_status()
            user_timezone = ZoneInfo(response.json()["timezone"])
    except (httpx.HTTPError, ValueError, KeyError, TypeError, ZoneInfoNotFoundError):
        raise HTTPException(status_code=503, detail="User timezone is unavailable") from None
    local_date = datetime.now(user_timezone).date()
    start = datetime.combine(local_date, time.min, user_timezone)
    end = datetime.combine(local_date + timedelta(days=1), time.min, user_timezone)
    activities = db.scalars(select(Activity).where(
        Activity.tenant_id == UUID(identity["tenant_id"]),
        Activity.user_id == UUID(identity["user_id"]), Activity.active.is_(True),
    ).order_by(Activity.preferred_time, Activity.id)).all()
    logs = db.scalars(select(ActivityLog).where(
        ActivityLog.tenant_id == UUID(identity["tenant_id"]),
        ActivityLog.user_id == UUID(identity["user_id"]),
        ActivityLog.logged_at >= start.astimezone(timezone.utc),
        ActivityLog.logged_at < end.astimezone(timezone.utc),
    ).order_by(ActivityLog.logged_at, ActivityLog.id)).all()
    latest = {log.activity_id: log.status for log in logs}
    return [TodayItem(
        **ActivityResponse.model_validate(activity).model_dump(),
        status=latest.get(activity.id),
        due_at=datetime.combine(local_date, time.fromisoformat(activity.preferred_time), user_timezone),
    ) for activity in activities
        if activity.frequency == "daily" or local_date.weekday() in activity.days_of_week]


@router.post(
    "/internal/logs", response_model=LogResponse | dict[str, bool], status_code=201,
    dependencies=[Depends(internal_only)], include_in_schema=False,
)
def partner_log(body: PartnerLogCreate, db: Database, request: Request, response: Response) -> ActivityLog | dict[str, bool]:
    # Resolve ownership even for retries so another tenant cannot probe an event ID.
    activity = find_activity(db, body.activity_id, body.tenant_id, body.user_id)
    existing = duplicate_log(db, body.tenant_id, body.source_event_id)
    if existing is not None:
        if existing.activity_id != body.activity_id or existing.user_id != body.user_id:
            raise HTTPException(status_code=409, detail="Source event already belongs to another activity")
        response.status_code = 200
        return {"duplicate": True}
    try:
        return persist_log(db, activity, body, request, "partner", body.source_event_id, body.metadata)
    except IntegrityError:
        db.rollback()
        existing = duplicate_log(db, body.tenant_id, body.source_event_id)
        if existing is None or existing.activity_id != body.activity_id or existing.user_id != body.user_id:
            raise HTTPException(status_code=409, detail="Source event is already in use") from None
        response.status_code = 200
        return {"duplicate": True}


@router.get(
    "/internal/users/{uid}/logs", response_model=list[LogResponse],
    dependencies=[Depends(internal_only)], include_in_schema=False,
)
def user_logs(uid: UUID, since: AwareDatetime, identity: Identity, db: Database) -> list[ActivityLog]:
    return list(db.scalars(select(ActivityLog).where(
        ActivityLog.tenant_id == UUID(identity["tenant_id"]), ActivityLog.user_id == uid,
        ActivityLog.logged_at >= since.astimezone(timezone.utc),
    ).order_by(ActivityLog.logged_at, ActivityLog.id)).all())


@router.patch(
    "/internal/{id}/schedule", response_model=ActivityResponse,
    dependencies=[Depends(internal_only)], include_in_schema=False,
)
def update_schedule(id: UUID, body: SchedulePatch, identity: Identity, db: Database) -> Activity:
    return patch_activity(owned_activity(db, id, identity), body, db)


@router.post("", response_model=ActivityResponse, status_code=201)
@router.post("/", response_model=ActivityResponse, status_code=201, include_in_schema=False)
def create_activity(body: ActivityCreate, identity: Identity, db: Database) -> Activity:
    activity = Activity(
        **body.model_dump(), tenant_id=UUID(identity["tenant_id"]),
        user_id=UUID(identity["user_id"]), active=True,
    )
    db.add(activity)
    db.commit()
    return activity


@router.get("", response_model=list[ActivityResponse])
@router.get("/", response_model=list[ActivityResponse], include_in_schema=False)
def list_activities(identity: Identity, db: Database) -> list[Activity]:
    return list(db.scalars(select(Activity).where(
        Activity.tenant_id == UUID(identity["tenant_id"]),
        Activity.user_id == UUID(identity["user_id"]), Activity.active.is_(True),
    ).order_by(Activity.name, Activity.id)).all())


@router.get("/{id}", response_model=ActivityResponse)
def get_activity(id: UUID, identity: Identity, db: Database) -> Activity:
    return owned_activity(db, id, identity)


@router.patch("/{id}", response_model=ActivityResponse)
def update_activity(id: UUID, body: ActivityPatch, identity: Identity, db: Database) -> Activity:
    return patch_activity(owned_activity(db, id, identity), body, db)


@router.delete("/{id}", status_code=204)
def delete_activity(id: UUID, identity: Identity, db: Database) -> Response:
    activity = owned_activity(db, id, identity)
    activity.active = False
    db.commit()
    return Response(status_code=204)


@router.post("/{id}/logs", response_model=LogResponse, status_code=201)
def log_activity(id: UUID, body: LogCreate, identity: Identity, db: Database, request: Request) -> ActivityLog:
    return persist_log(db, owned_activity(db, id, identity), body, request)


def parse_bound(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        raise HTTPException(status_code=422, detail="Use an ISO date or timestamp for log bounds") from None


@router.get("/{id}/logs", response_model=list[LogResponse])
def activity_logs(
    id: UUID, identity: Identity, db: Database,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: Annotated[str | None, Query()] = None,
) -> list[ActivityLog]:
    owned_activity(db, id, identity)
    query = select(ActivityLog).where(
        ActivityLog.tenant_id == UUID(identity["tenant_id"]),
        ActivityLog.user_id == UUID(identity["user_id"]), ActivityLog.activity_id == id,
    )
    lower = parse_bound(from_) if from_ is not None else None
    upper = parse_bound(to) if to is not None else None
    date_upper = to is not None and len(to) == 10
    if upper is not None and date_upper:
        try:
            upper += timedelta(days=1)
        except OverflowError:
            raise HTTPException(status_code=422, detail="Log end date is out of range") from None
    if lower is not None and upper is not None and (lower >= upper if date_upper else lower > upper):
        raise HTTPException(status_code=422, detail="from must precede to")
    if lower is not None:
        query = query.where(ActivityLog.logged_at >= lower)
    if upper is not None:
        if date_upper:
            query = query.where(ActivityLog.logged_at < upper)
        else:
            query = query.where(ActivityLog.logged_at <= upper)
    return list(db.scalars(query.order_by(ActivityLog.logged_at, ActivityLog.id)).all())
