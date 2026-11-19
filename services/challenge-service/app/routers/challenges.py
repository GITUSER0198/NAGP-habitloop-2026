"""Tenant-scoped challenge visibility, invitations and membership transitions."""

import secrets
import string
from datetime import date, datetime, timezone
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from habitloop_shared.auth import CurrentUser, current_user, internal_only
from habitloop_shared.config import get_settings
from habitloop_shared.db import get_db

from app.models import Challenge, Participant
from app.schemas import (
    ChallengeCreate, ChallengeCreated, ChallengeResponse, CodeJoin, InviteCreate,
    InviteResponse, ParticipantResponse,
)

router = APIRouter(prefix="/api/challenges", tags=["challenges"])
Database = Annotated[Session, Depends(get_db)]
Identity = Annotated[CurrentUser, Depends(current_user)]


def today() -> date:
    return datetime.now(timezone.utc).date()


def generate_invite_code() -> str:
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))


def find_challenge(db: Session, challenge_id: UUID, identity: CurrentUser, lock: bool = False) -> Challenge:
    query = select(Challenge).where(
        Challenge.tenant_id == UUID(identity["tenant_id"]), Challenge.id == challenge_id,
    )
    # Serialize participation mutations on PostgreSQL without locking unrelated challenges.
    if lock:
        query = query.with_for_update()
    challenge = db.scalar(query)
    if challenge is None:
        raise HTTPException(status_code=404, detail="Challenge not found")
    return challenge


def participant_for(db: Session, challenge: Challenge, user_id: UUID) -> Participant | None:
    return db.scalar(select(Participant).where(
        Participant.tenant_id == challenge.tenant_id,
        Participant.challenge_id == challenge.id, Participant.user_id == user_id,
    ))


def require_visible(db: Session, challenge: Challenge, identity: CurrentUser) -> None:
    if challenge.visibility == "public" or challenge.owner_id == UUID(identity["user_id"]):
        return
    participant = participant_for(db, challenge, UUID(identity["user_id"]))
    if participant is None or participant.status not in {"invited", "joined"}:
        raise HTTPException(status_code=404, detail="Challenge not found")


def require_open(challenge: Challenge) -> None:
    if challenge.end_date < today():
        raise HTTPException(status_code=409, detail="Challenge has ended")


def join_challenge(db: Session, challenge: Challenge, identity: CurrentUser) -> Participant:
    require_open(challenge)
    participant = participant_for(db, challenge, UUID(identity["user_id"]))
    if participant is None:
        participant = Participant(
            tenant_id=challenge.tenant_id, challenge_id=challenge.id,
            user_id=UUID(identity["user_id"]), status="joined", joined_at=datetime.now(timezone.utc),
        )
        db.add(participant)
    elif participant.status != "joined":
        participant.status = "joined"
        participant.joined_at = datetime.now(timezone.utc)
    db.commit()
    return participant


@router.post("", response_model=ChallengeCreated, status_code=201)
@router.post("/", response_model=ChallengeCreated, status_code=201, include_in_schema=False)
def create_challenge(body: ChallengeCreate, identity: Identity, db: Database) -> Challenge:
    for _ in range(5):
        challenge = Challenge(
            **body.model_dump(), tenant_id=UUID(identity["tenant_id"]),
            owner_id=UUID(identity["user_id"]), invite_code=generate_invite_code(),
        )
        db.add(challenge)
        try:
            db.flush()
            db.add(Participant(
                challenge_id=challenge.id, tenant_id=challenge.tenant_id, user_id=challenge.owner_id,
                status="joined", joined_at=datetime.now(timezone.utc),
            ))
            db.commit()
            return challenge
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=503, detail="Could not allocate an invite code. Try again")


@router.get("/feed", response_model=list[ChallengeResponse])
def feed(identity: Identity, db: Database) -> list[Challenge]:
    tenant_id, user_id = UUID(identity["tenant_id"]), UUID(identity["user_id"])
    belongs = select(Participant.challenge_id).where(
        Participant.tenant_id == tenant_id, Participant.user_id == user_id,
        Participant.status.in_(["invited", "joined"]),
    )
    return list(db.scalars(select(Challenge).where(
        Challenge.tenant_id == tenant_id,
        or_(Challenge.visibility == "public", Challenge.owner_id == user_id, Challenge.id.in_(belongs)),
    ).order_by(Challenge.start_date.desc(), Challenge.id)).all())


@router.get("/invites", response_model=list[ChallengeResponse])
def pending_invites(identity: Identity, db: Database) -> list[Challenge]:
    tenant_id = UUID(identity["tenant_id"])
    return list(db.scalars(select(Challenge).join(Participant, and_(
        Participant.challenge_id == Challenge.id, Participant.tenant_id == Challenge.tenant_id,
    )).where(
        Challenge.tenant_id == tenant_id, Participant.tenant_id == tenant_id,
        Participant.user_id == UUID(identity["user_id"]), Participant.status == "invited",
    ).order_by(Challenge.start_date.desc(), Challenge.id)).all())


@router.post("/join-by-code", response_model=ParticipantResponse)
def join_by_code(body: CodeJoin, identity: Identity, db: Database) -> Participant:
    challenge = db.scalar(select(Challenge).where(
        Challenge.tenant_id == UUID(identity["tenant_id"]), Challenge.invite_code == body.invite_code,
    ).with_for_update())
    if challenge is None:
        raise HTTPException(status_code=404, detail="Challenge not found")
    return join_challenge(db, challenge, identity)


@router.get(
    "/internal/users/{uid}/active", response_model=list[UUID],
    dependencies=[Depends(internal_only)], include_in_schema=False,
)
def active_challenges(uid: UUID, identity: Identity, db: Database, category: str | None = None) -> list[UUID]:
    tenant_id = UUID(identity["tenant_id"])
    query = select(Challenge.id).join(Participant, and_(
        Participant.challenge_id == Challenge.id, Participant.tenant_id == Challenge.tenant_id,
    )).where(
        Challenge.tenant_id == tenant_id, Participant.tenant_id == tenant_id,
        Participant.user_id == uid, Participant.status == "joined",
        Challenge.start_date <= today(), Challenge.end_date >= today(),
    )
    if category is not None:
        query = query.where(Challenge.activity_category == category)
    return list(db.scalars(query.order_by(Challenge.id)).all())


@router.post("/invites/{challenge_id}/accept", response_model=ParticipantResponse)
def accept_invite(challenge_id: UUID, identity: Identity, db: Database) -> Participant:
    challenge = find_challenge(db, challenge_id, identity, lock=True)
    participant = participant_for(db, challenge, UUID(identity["user_id"]))
    if participant is None or participant.status not in {"invited", "joined"}:
        raise HTTPException(status_code=404, detail="Pending invite not found")
    # A successful acceptance remains idempotent even after the challenge ends.
    if participant.status == "joined":
        return participant
    return join_challenge(db, challenge, identity)


@router.post("/invites/{challenge_id}/decline", response_model=ParticipantResponse)
def decline_invite(challenge_id: UUID, identity: Identity, db: Database) -> Participant:
    challenge = find_challenge(db, challenge_id, identity, lock=True)
    participant = participant_for(db, challenge, UUID(identity["user_id"]))
    if participant is None or participant.status == "left":
        raise HTTPException(status_code=404, detail="Pending invite not found")
    if participant.status == "joined":
        raise HTTPException(status_code=409, detail="Leave the challenge to end participation")
    participant.status = "declined"
    db.commit()
    return participant


@router.get("/{id}", response_model=ChallengeResponse)
def get_challenge(id: UUID, identity: Identity, db: Database) -> Challenge:
    challenge = find_challenge(db, id, identity)
    require_visible(db, challenge, identity)
    return challenge


@router.post("/{id}/join", response_model=ParticipantResponse)
def join_public(id: UUID, identity: Identity, db: Database) -> Participant:
    challenge = find_challenge(db, id, identity, lock=True)
    require_visible(db, challenge, identity)
    if challenge.visibility != "public":
        raise HTTPException(status_code=409, detail="Private challenges require an invite or code")
    return join_challenge(db, challenge, identity)


@router.post("/{id}/leave", response_model=ParticipantResponse)
def leave_challenge(id: UUID, identity: Identity, db: Database) -> Participant:
    challenge = find_challenge(db, id, identity, lock=True)
    participant = participant_for(db, challenge, UUID(identity["user_id"]))
    if participant is None or participant.status not in {"joined", "left"}:
        raise HTTPException(status_code=404, detail="Participation not found")
    participant.status = "left"
    db.commit()
    return participant


def validate_recipients(user_ids: list[UUID], request: Request) -> None:
    if not user_ids:
        return
    settings = get_settings()
    headers = {
        "Authorization": request.headers["Authorization"],
        "X-Internal-Token": settings.internal_token.get_secret_value(),
    }
    try:
        with httpx.Client(timeout=3.0) as client:
            for user_id in user_ids:
                response = client.get(
                    f"{settings.user_service_url}/api/users/internal/users/{user_id}", headers=headers,
                )
                if response.status_code == 404:
                    raise HTTPException(status_code=404, detail="Invite recipient not found")
                response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Invite recipients could not be verified") from None


def resolve_emails(emails: list[str], request: Request) -> list[UUID]:
    if not emails:
        return []
    settings = get_settings()
    resolved: list[UUID] = []
    try:
        with httpx.Client(timeout=3.0) as client:
            for email in emails:
                response = client.get(
                    f"{settings.user_service_url}/api/users/internal/users",
                    params={"email": email},
                    headers={"Authorization": request.headers["Authorization"],
                             "X-Internal-Token": settings.internal_token.get_secret_value()},
                )
                if response.status_code == 404:
                    raise HTTPException(status_code=404, detail=f"No participant found for {email}")
                response.raise_for_status()
                resolved.append(UUID(response.json()["id"]))
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=503, detail="Invite recipients could not be verified") from None
    return resolved


@router.post("/{id}/invites", response_model=InviteResponse)
def invite_users(
    id: UUID, identity: Identity, db: Database, request: Request, body: InviteCreate | None = None,
) -> InviteResponse:
    challenge = find_challenge(db, id, identity, lock=True)
    require_visible(db, challenge, identity)
    if challenge.owner_id != UUID(identity["user_id"]):
        raise HTTPException(status_code=403, detail="Only the challenge owner can invite users")
    require_open(challenge)
    user_ids = [] if body is None else list(body.user_ids)
    validate_recipients(user_ids, request)
    if body is not None:
        user_ids = list(dict.fromkeys([*user_ids, *resolve_emails(body.emails, request)]))
    for user_id in user_ids:
        participant = participant_for(db, challenge, user_id)
        if participant is None:
            db.add(Participant(
                tenant_id=challenge.tenant_id, challenge_id=challenge.id,
                user_id=user_id, status="invited", joined_at=None,
            ))
        elif participant.status in {"declined", "left"}:
            participant.status = "invited"
            participant.joined_at = None
    db.commit()
    return InviteResponse(invite_code=challenge.invite_code, user_ids=user_ids)
