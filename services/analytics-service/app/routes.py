"""Tenant-scoped dashboard analytics and cancellable live summary streaming."""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from habitloop_shared.analytics import (
    BADGE_DAYS, analytics_table, challenge_pk, counts, live_streak, query_items, user_pk,
)
from habitloop_shared.auth import CurrentUser, bearer, current_user, internal_only
from habitloop_shared.config import get_settings

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
Identity = Annotated[CurrentUser, Depends(current_user)]
Table = Annotated[Any, Depends(analytics_table)]
POLL_SECONDS = 3.0
HEARTBEAT_SECONDS = 15.0


def today() -> date:
    return datetime.now(timezone.utc).date()


def daily_rows(table: Any, identity: CurrentUser, days: int) -> list[dict[str, Any]]:
    end = today()
    start = end - timedelta(days=days - 1)
    rows = {item["date"]: item for item in query_items(table, user_pk(**identity), "DAY#")}
    return [{"date": day.isoformat(), **counts(rows.get(day.isoformat(), {}))}
            for day in (start + timedelta(days=index) for index in range(days))]


def summary_snapshot(table: Any, identity: CurrentUser) -> tuple[dict[str, Any], int]:
    pk = user_pk(**identity)
    # Reading the revision first means a concurrent write is seen on this or the next poll.
    streak = table.get_item(Key={"PK": pk, "SK": "STREAK"}, ConsistentRead=True).get("Item", {})
    rows = daily_rows(table, identity, 7)
    successes = sum(row["done"] + row["completed"] for row in rows)
    attempts = successes + sum(row["missed"] for row in rows)
    return {
        "today": rows[-1], "rate_7d": successes / attempts if attempts else 0.0,
        "current_streak": live_streak(streak, today()), "best_streak": int(streak.get("best", 0)),
    }, int(streak.get("revision", 0))


@router.get("/summary")
def summary(identity: Identity, table: Table) -> dict[str, Any]:
    return summary_snapshot(table, identity)[0]


@router.get("/trend")
def trend(identity: Identity, table: Table, days: Annotated[int, Query(ge=1, le=3660)] = 30) -> list[dict[str, Any]]:
    return daily_rows(table, identity, days)


@router.get("/heatmap")
def heatmap(identity: Identity, table: Table, days: Annotated[int, Query(ge=1, le=3660)] = 365) -> list[dict[str, Any]]:
    return daily_rows(table, identity, days)


@router.get("/cohorts")
def cohorts(identity: Identity, table: Table) -> list[dict[str, Any]]:
    result = []
    for item in query_items(table, user_pk(**identity), "COHORT#"):
        attempts, successes = int(item.get("attempts", 0)), int(item.get("successes", 0))
        result.append({"week": item["week"], **counts(item), "attempts": attempts,
                       "successes": successes, "rate": successes / attempts if attempts else 0.0})
    return result


@router.get("/challenges/{id}/progress")
def challenge_progress(id: UUID, request: Request, identity: Identity, table: Table) -> dict[str, Any]:
    settings = get_settings()
    # The source service owns visibility, including private challenges within the same tenant.
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(
                f"{settings.challenge_service_url}/api/challenges/{id}",
                headers={"Authorization": request.headers["Authorization"],
                         "X-Internal-Token": settings.internal_token.get_secret_value()},
            )
            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Challenge not found")
            response.raise_for_status()
            target = int(response.json()["target_count"])
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=503, detail="Challenge could not be verified") from None
    rows = query_items(table, challenge_pk(identity["tenant_id"], str(id)), "PROGRESS#")
    leaderboard = [{"user_id": item["user_id"], "count": int(item.get("count", 0)), "target": target}
                   for item in rows]
    leaderboard.sort(key=lambda item: (-item["count"], item["user_id"]))
    for rank, item in enumerate(leaderboard, start=1):
        item["rank"] = rank
    return {"challenge_id": str(id), "target": target, "leaderboard": leaderboard}


def milestone_scope(items: list[dict[str, Any]], prefix: str) -> dict[str, Any]:
    by_key = {item["SK"]: item for item in items}
    streak = by_key.get(f"{prefix}STREAK", {})
    current = live_streak(streak, today())
    earned = [{"days": days, "earned_date": by_key[f"{prefix}BADGE#{days}"]["earned_date"]}
              for days in BADGE_DAYS if f"{prefix}BADGE#{days}" in by_key]
    earned_days = {badge["days"] for badge in earned}
    next_days = next((days for days in BADGE_DAYS if days not in earned_days), None)
    return {"current_streak": current, "best_streak": int(streak.get("best", 0)), "earned": earned,
            "next": {"days": next_days, "days_remaining": max(0, next_days - current)} if next_days else None}


@router.get("/milestones")
def milestones(identity: Identity, table: Table) -> dict[str, Any]:
    pk = user_pk(**identity)
    overall = query_items(table, pk, "BADGE#")
    overall.extend(query_items(table, pk, "STREAK"))
    activity_items = query_items(table, pk, "ACTIVITY#")
    activity_ids = sorted({item["SK"].split("#")[1] for item in activity_items})
    return {"overall": milestone_scope(overall, ""), "activities": [
        {"activity_id": aid, **milestone_scope(activity_items, f"ACTIVITY#{aid}#")}
        for aid in activity_ids
    ]}


@router.get("/internal/users/{uid}/hours", dependencies=[Depends(internal_only)], include_in_schema=False)
def hours(uid: UUID, identity: Identity, table: Table) -> list[dict[str, Any]]:
    return [{"hour": item["SK"].removeprefix("HOUR#"), "attempts": int(item.get("attempts", 0)),
             "successes": int(item.get("successes", 0))}
            for item in query_items(table, user_pk(identity["tenant_id"], str(uid)), "HOUR#")]


async def stream_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    token: Annotated[str | None, Query()] = None,
) -> CurrentUser:
    if credentials is None and token:
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    return await current_user(credentials)


async def summary_events(request: Request, table: Any, identity: CurrentUser) -> AsyncIterator[str]:
    previous: tuple[dict[str, Any], int] | None = None
    heartbeat = time.monotonic()
    while not await request.is_disconnected():
        snapshot = await run_in_threadpool(summary_snapshot, table, identity)
        if snapshot != previous:
            yield f"event: summary\ndata: {json.dumps(snapshot[0], separators=(',', ':'))}\n\n"
            previous = snapshot
        now = time.monotonic()
        if now - heartbeat >= HEARTBEAT_SECONDS:
            yield ": heartbeat\n\n"
            heartbeat = now
        # Starlette cancels this generator on disconnect, including while sleeping or reading.
        await asyncio.sleep(POLL_SECONDS)


@router.get("/stream")
async def stream(
    request: Request, identity: Annotated[CurrentUser, Depends(stream_user)], table: Table,
) -> StreamingResponse:
    return StreamingResponse(summary_events(request, table, identity), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
