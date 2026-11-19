"""Authenticated refresh, list, accept and dismiss operations."""

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from uuid import UUID

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from habitloop_shared import events
from habitloop_shared.auth import CurrentUser, current_user
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_db

from app.models import Recommendation
from app.rules import NEEDS_DATA, Suggestion, evaluate
from app.schemas import (
    ActivityHistory, HourHistory, LogHistory, RecommendationList, RecommendationResponse,
    RecommendationStatus,
)

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])
Identity = Annotated[CurrentUser, Depends(current_user)]
Database = Annotated[Session, Depends(get_db)]


def now() -> datetime:
    return datetime.now(timezone.utc)


def service_headers(request: Request) -> dict[str, str]:
    return {
        "Authorization": request.headers["Authorization"],
        "X-Internal-Token": get_settings().internal_token.get_secret_value(),
    }


def read_candidates(request: Request, identity: CurrentUser) -> tuple[list[Suggestion], bool]:
    settings = get_settings()
    end = now()
    start = end - timedelta(days=14)
    try:
        with httpx.Client(timeout=5.0, headers=service_headers(request)) as client:
            activity_response = client.get(f"{settings.activity_service_url}/api/activities")
            activity_response.raise_for_status()
            activities = TypeAdapter(list[ActivityHistory]).validate_python(activity_response.json())
            activities = [activity for activity in activities if activity.active
                          and str(activity.tenant_id) == identity["tenant_id"]
                          and str(activity.user_id) == identity["user_id"]]
            if not activities:
                return [], True
            hour_response = client.get(
                f"{settings.analytics_service_url}/api/analytics/internal/users/{identity['user_id']}/hours",
            )
            hour_response.raise_for_status()
            hours = TypeAdapter(list[HourHistory]).validate_python(hour_response.json())
            log_response = client.get(
                f"{settings.activity_service_url}/api/activities/internal/users/{identity['user_id']}/logs",
                params={"since": start.isoformat()},
            )
            log_response.raise_for_status()
            logs = TypeAdapter(list[LogHistory]).validate_python(log_response.json())
            logs = [log for log in logs if str(log.tenant_id) == identity["tenant_id"]
                    and str(log.user_id) == identity["user_id"] and start <= log.logged_at <= end]
    except (httpx.HTTPError, ValidationError, ValueError, TypeError):
        raise HTTPException(status_code=503, detail="Recommendation history is unavailable") from None
    return evaluate(activities, hours, logs)


def scoped_query(identity: CurrentUser) -> Any:
    return select(Recommendation).where(
        Recommendation.tenant_id == UUID(identity["tenant_id"]),
        Recommendation.user_id == UUID(identity["user_id"]),
    )


def listed(db: Session, identity: CurrentUser, status: RecommendationStatus) -> list[Recommendation]:
    return list(db.scalars(scoped_query(identity).where(Recommendation.status == status)
                           .order_by(Recommendation.created_at, Recommendation.id)).all())


def result(rows: list[Recommendation], enough_data: bool = True) -> RecommendationList:
    return RecommendationList(
        recommendations=[RecommendationResponse.model_validate(row) for row in rows],
        reason=NEEDS_DATA if not rows and not enough_data else None,
    )


@router.post("/refresh", response_model=RecommendationList, response_model_exclude_none=True)
def refresh(request: Request, identity: Identity, db: Database) -> RecommendationList:
    candidates, enough_data = read_candidates(request, identity)
    pending = listed(db, identity, "pending")
    for candidate in candidates:
        if any(row.activity_id == candidate.activity.id and row.kind == candidate.kind
               and row.current_value == candidate.current_value
               and row.suggested_value == candidate.suggested_value for row in pending):
            continue
        row = Recommendation(
            tenant_id=UUID(identity["tenant_id"]), user_id=UUID(identity["user_id"]),
            activity_id=candidate.activity.id, kind=candidate.kind,
            current_value=candidate.current_value, suggested_value=candidate.suggested_value,
            reason=candidate.reason, confidence=candidate.confidence,
        )
        try:
            # The partial unique index also deduplicates concurrent refreshes.
            with db.begin_nested():
                db.add(row)
                db.flush()
        except IntegrityError:
            continue
        pending.append(row)
    db.commit()
    return result(listed(db, identity, "pending"), enough_data)


@router.get("", response_model=RecommendationList, response_model_exclude_none=True)
@router.get("/", response_model=RecommendationList, response_model_exclude_none=True, include_in_schema=False)
def list_recommendations(
    request: Request, identity: Identity, db: Database, status: RecommendationStatus = "pending",
) -> RecommendationList:
    rows = listed(db, identity, status)
    enough_data = True
    if not rows and status == "pending":
        _, enough_data = read_candidates(request, identity)
    return result(rows, enough_data)


def owned(db: Session, identity: CurrentUser, recommendation_id: UUID) -> Recommendation:
    row = db.scalar(scoped_query(identity).where(Recommendation.id == recommendation_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return row


@router.post("/{id}/accept", response_model=RecommendationResponse)
def accept(id: UUID, request: Request, identity: Identity, db: Database) -> Recommendation:
    row = owned(db, identity, id)
    if row.status == "accepted":
        return row
    if row.status == "dismissed":
        raise HTTPException(status_code=409, detail="Recommendation is dismissed")
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.patch(
                f"{get_settings().activity_service_url}/api/activities/internal/{row.activity_id}/schedule",
                headers=service_headers(request), json=row.suggested_value,
            )
            if response.status_code in {404, 409}:
                row.status = "dismissed"
                db.commit()
                raise HTTPException(status_code=409, detail="Activity no longer applies")
            response.raise_for_status()
        events.publish("RecommendationAccepted", {
            "tenant_id": identity["tenant_id"], "user_id": identity["user_id"],
            "recommendation_id": str(row.id), "activity_id": str(row.activity_id),
        })
    except (httpx.HTTPError, RuntimeError, BotoCoreError, ClientError):
        db.rollback()
        raise HTTPException(status_code=502, detail="Recommendation could not be accepted; retry later") from None
    row.status = "accepted"
    db.commit()
    return row


@router.post("/{id}/dismiss", response_model=RecommendationResponse)
def dismiss(id: UUID, identity: Identity, db: Database) -> Recommendation:
    row = owned(db, identity, id)
    if row.status == "accepted":
        raise HTTPException(status_code=409, detail="Recommendation is already accepted")
    row.status = "dismissed"
    db.commit()
    return row
